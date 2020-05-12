'use strict';

const fs = require('fs');
const util = require('util');
const dateFormat = require('dateformat');

const fsReadFile = util.promisify(fs.readFile);
const sleep      = util.promisify(setTimeout);

const ACs = require('./classes/ApiCallers');
const LogStream = require('./classes/LogStream');
const LoadQueue = require('./classes/LoadQueue');

module.exports = class VkAlbPoster {
  constructor({ group_id, tokens, options }) {
    this.storage = {
      acs: new ACs(tokens),
      group_id, 
      options
    }
  }

  static delaysTable = [ // delay | uploaded pictures before token ban
    [15, 2000],
    [45, 2975],
    [65, 5000]
  ];

  async post({ albums: newAlbums }) {
    const acs = this.storage.acs;
    const acsQuantity = Object.keys(acs.list).length;
    const _options = this.storage.options;

    const albums = {
      new: newAlbums
    }

    const preInitAsyncs = [
      // existing albums of the group
      VkAlbPoster.getAlbums(acs.next().apiCaller, '-' + this.storage.group_id)
    ]

    for (const albumParams of albums.new) {
      preInitAsyncs.push(VkAlbPoster.parseInput(albumParams.descrsPath))
    }

    const preInitAsyncResults = await Promise.allSettled(preInitAsyncs);
    const preInitBads = preInitAsyncResults.filter(result => {
      return result.status === "rejected" ? true : false;
    });

    for (const result of preInitBads) {
      console.error(result.reason);
    }

    if (preInitBads.length) {
      throw new Error('Загрузка альбомов отменена. Исправьте все перечисленные выше ошибки');
    }
    
    albums.existing = preInitAsyncResults[0].value;

    for (let i = 1; i < preInitAsyncResults.length; i++) {
      const result = preInitAsyncResults[i];
      
      albums.new[i - 1].parsedDescrs = result.value;
    }

    const saveDelay = VkAlbPoster.calcSaveDelay(
      albums.new, _options.customDelays, acsQuantity
    );

    VkAlbPoster.log('info', `Запуск с параметрами: \nЗадержка: ${saveDelay / 1000} секунд; Группа: vk.com/club${this.storage.group_id}`);
    
    // main cycle
    for (const albumParams of albums.new) {
      let jsonFirstPicWritten = false;

      VkAlbPoster.log('info', `Подготовка к загрузке альбома "${albumParams.name}"...`);
      
      // if the group already has an album with the given name
      if (albums.existing[albumParams.name]) {
        albumParams.id = albums.existing[albumParams.name].id;
      }

      if (!albumParams.id) {
        const ac = acs.next();
        let newAlbumObj;

        try {
          newAlbumObj = await VkAlbPoster.createAlbum(ac.apiCaller, {
            title: albumParams.name,
            group_id: this.storage.group_id
          });
        } catch (e) {
          const msg = `Не удалось создать альбом "${albumParams.name}" в группе vk.com/club${this.storage.group_id}\nТекущий токен: ${ac.token}`;

          VkAlbPoster.log('error', msg);
          throw e;
        }

        albumParams.id = newAlbumObj.id;
      }

      const logFStream = (() => {
        try {
          const logFStream = new LogStream(albumParams.logFilePath);

          logFStream.write(
            `{\n  "groupId": ${this.storage.group_id},\n  "albumId": ${albumParams.id},\n  "savedPics": [`
          );

          return logFStream;
        } catch(e) {
          VkAlbPoster.log('error', `Ошибка при создании лог-файла "${logFileFullPath}"`);
          throw e;
        }
      })();

      for (const apiCallerToken in acs.list) {
        const apiCallerParams = acs.list[apiCallerToken];
        const apiCaller = apiCallerParams.apiCaller;
        const moduleObj = apiCaller.vkAlbPoster = {};
        const albumObj = moduleObj[Number(albumParams.id)] = {};

        albumObj.uploadUrl = await VkAlbPoster.getUploadServer(
          apiCaller, this.storage.group_id, albumParams.id
        );
      }

      VkAlbPoster.log('info', `Подготовка к загрузке альбома "${albumParams.name}" успешна. Ссылка: vk.com/album-${this.storage.group_id}_${albumParams.id}. Загрузка...`);

      const loadQueue = new LoadQueue(albumParams.imgsPath, albumParams.id);
      const executeChunkSize = 25;

      let loadData = (() => {
        const shift = acsQuantity * executeChunkSize * 2;
        const output = {
          loaders: acs,
          items: VkAlbPoster.makeLoadData(shift, executeChunkSize, albumParams)
        };

        albumParams.parsedDescrs = albumParams.parsedDescrs.slice(shift);
        return output;
      })();
      
      let loadDataLog = [];
      let loadResults = await loadQueue.load(loadData);

      while (loadResults.length) {
        const saveResults = [];
        const loadResultsPart = loadResults.slice(0, acsQuantity);

        for (let i = 0; i < loadResultsPart.length; i++) {
          const loadResult = loadResults[i];
          const lastSaveDiff = Date.now() - loadResult.loader.lastSaveCallTime;
          const delay = lastSaveDiff > saveDelay ? 0 : saveDelay - lastSaveDiff;

          if (delay) { await sleep(delay) }

          const output = await VkAlbPoster.savePhotos(
            loadResult.loader.apiCaller, loadResult.responses
          );

          loadResult.loader.lastSaveCallTime = Date.now();

          saveResults.push(output);
        }

        loadDataLog = loadDataLog.concat([].concat.apply([], loadData.items));

        for (let i = 0; i < saveResults.length; i++) {
          const saveResponses = saveResults[i].response;
          const saveErrors = saveResults[i].errors;

          if (saveErrors && saveErrors.length) {
            logFStream.write(`\n  ]\n}`);
            logFStream.end();

            const errorTypes = {};

            saveErrors.map(errorObj => {
              if (!errorTypes.hasOwnProperty(errorObj.code)) {
                errorTypes[errorObj.code] = { message: errorObj.message, counter: 0 };
              }
              
              errorTypes[errorObj.code].counter++;
            });

            let errorsEnumStr = '';

            for (const errorsCode in errorTypes) {
              const errorObj = errorTypes[errorsCode];
                
              errorsEnumStr += `\nТекст: ${errorObj.message}; количество ошибок: ${errorObj.counter}`;
            }

            throw new Error(`${saveErrors.length > 1 ? 'Ошибки' : 'Ошибка'} при сохранении картинок в альбоме:${errorsEnumStr}\nТекущий токен: ${loadResultsPart[i].loader.token}`);
          }

          for (let x = 0; x < saveResponses.length; x++) {
            const inputItem = loadDataLog[x];
            const savedItem = saveResponses[x];

            const picFilename = JSON.stringify(inputItem.filename);
            const picCaption = JSON.stringify(inputItem.caption);

            logFStream.write(
              `${jsonFirstPicWritten ? ',\n' : '\n'}    {\n      "filename": ${picFilename},\n      "vkId": ${savedItem.id}${picCaption ? ',\n      "caption": ' + picCaption : ''}\n    }`
            );

            jsonFirstPicWritten = true;
          }

          loadDataLog = loadDataLog.slice(saveResponses.length);
        }

        loadData.items = VkAlbPoster.makeLoadData(executeChunkSize, executeChunkSize, albumParams);

        albumParams.parsedDescrs = albumParams.parsedDescrs.slice(executeChunkSize);

        loadResults = loadResults
          .slice(acsQuantity)
          .concat(await loadQueue.load(loadData));
      }
      
      logFStream.write(`\n  ]\n}`);
      logFStream.end();

      VkAlbPoster.log('info', `Альбом "${albumParams.name}" загружен`);
    }

    return 'VkAlbPoster закончил работу';
  }

  static consoleName = 'vk-groups-albums-poster'; // used in console logging

  static log(lvl, msg) {
    const prefix = `${dateFormat(Date.now(), 'HH:MM:ss')} ${VkAlbPoster.consoleName}:`;

    switch (lvl) {
      case 'info':
        console.log(prefix, msg);
        break;

      case 'error':
        console.error(prefix, msg);
        break;
    }
  }

  static async parseInput(descrsPath) {
    const data = await fsReadFile(descrsPath);
    const descriptions = JSON.parse(data.toString()).descriptions;

    if (!descriptions.length) {
      throw new Error(`В "${descrsPath}" не предоставлены названия файлов для загрузки`);
    }

    const badDescrObjects = {
      unpaired: {}
    }

    for (let i = 1; i <= descriptions.length; i++) {
      const descrObj = descriptions[i - 1];
      
      if (!descrObj.filename && descrObj.caption) {
        badDescrObjects.unpaired[i] = descrObj;
      }
    }

    if (Object.keys(badDescrObjects.unpaired).length) {
      let msg = `В файле описаний по пути "${descrsPath}" обнаружены объекты с указанием подписи к фото, но без указания имени файла. Вы что-то пропустили? Удалите или исправьте объекты перечисленные ниже. № - номер в массиве\n`;

      for (const objId in badDescrObjects.unpaired) {
        const obj = badDescrObjects.unpaired[objId];

        msg = `${msg} №${objId}: ${JSON.stringify(obj)}\n`;
      }

      throw new Error(msg);
    }

    return descriptions;
  }

  static async getAlbums(vk, owner_id) {
    const output = {};
    const response = await vk.api.photos.getAlbums({ owner_id });

    response.items.forEach((item) => { output[item.title] = item });
  
    return output;
  }

  static async getUploadServer(vk, group_id, album_id) {
    const response = await vk.api.photos.getUploadServer({ group_id, album_id });

    if (!response || !response.upload_url) {
      throw new Error('Failed to get upload url');
    }
  
    return response.upload_url;
  }

  static async createAlbum(vk, args) {
    const response = await vk.api.photos.createAlbum(args);

    if (response.id) return response;

    throw new Error('Failed to create new album');
  }

  static calcSaveDelay(newAlbums, userDelays, acsQuantity) {
    const extraDelay = Number(userDelays.extra) * 1000 || 0;

    if (userDelays.hasOwnProperty('constant')) {
      return Number(userDelays.constant) * 1000 + extraDelay;
    }

    let picsOverallCount = 0;
    let output = 0;
    
    for (const album of newAlbums) {
      picsOverallCount += album.parsedDescrs.length;
    }
    
    for (const row of VkAlbPoster.delaysTable) {
      const recommendedDelay = row[0];
      const picsLimit = row[1] * acsQuantity;

      if (picsLimit >= picsOverallCount) {
        output = recommendedDelay;
        break;
      }
    }

    if (output === 0) {
      throw new Error('Слишком мало токенов для такого количества картинок. Избежать "flood control" не удастся. Подробности в документации');
    }

    return output * 1000 + extraDelay;
  }

  static makeLoadData(shift, executeChunkSize, albumParams) {
    const items = albumParams.parsedDescrs.slice(0, shift); // x2 preload
    const splittedItems = [].concat.apply([], 
        items.map(function(elem, i) {
          return i % executeChunkSize ? [] : [items.slice(i, i + executeChunkSize)];
        }
      ) // divide by 25 due to vk.api.execute restrictions
    )

    return splittedItems;
  }

  static async savePhotos(vk, saveData) {
    const execString = VkAlbPoster.savePhotosExec.toString();
    let execBody = execString.slice(execString.indexOf('{') + 1, -1);

    execBody = execBody.replace('REPLACE1', JSON.stringify(saveData)); 
    
    return await vk.api.execute({ code: execBody });
  }

  // will be converted to string
  static savePhotosExec() {
    var saveData = REPLACE1;
    var saveResults = [];

    var i = 0, args, r;
    while (i < saveData.length) {
      args = saveData[i];
      i = i + 1;

      r = API.photos.save({
        server: args.server,
        photos_list: args.photos_list,
        album_id: args.aid,
        group_id: args.gid,
        hash: args.hash,
        caption: args.caption
      });

      saveResults.push(r[0]);
    }

    return saveResults;
  }
}
