'use strict';

const fs = require('fs');
const util = require('util');
const fetch = require('node-fetch');
const FormData = require('form-data');

const fsAccess = util.promisify(fs.access);

module.exports = class LoadQueue {
  constructor(imgsPath, albumId) {
    this.imgsPath = imgsPath;
    this.albumId = albumId;
  }

  async load({ items, loaders }) {
    const formdatasPromises = [];

    for (const item of items) {
      formdatasPromises.push(await LoadQueue.makeFormdatas(item, this.imgsPath));
    }

    const formdatasChunks = await Promise.all(formdatasPromises);
    const fetchChunks = [];

    for (let i = 0; i < formdatasChunks.length; i++) {
      const formdatas = formdatasChunks[i];
      const loader = loaders.next();
      const apiCaller = loader.apiCaller;
      const uploadUrl = apiCaller.vkAlbPoster[this.albumId].uploadUrl;
      const fetchChunk = fetchChunks[i] = { loader, fetches: [] };

      for (const formdata of formdatas) {
        fetchChunk.fetches.push(fetch(uploadUrl, {
          method: 'POST',
          body: formdata
        }).then(res => res.json()));
      }
    }

    const promiseAllArr = [];

    for (const fetchChunk of fetchChunks) {
      promiseAllArr.push(Promise.all(fetchChunk.fetches));
    }
    
    // promiseAll promiseAll
    const responsesChunks = await Promise.all(promiseAllArr);

    const splittedChunks = responsesChunks.map(chunk => {
      const newChunk = [];

      for (const item of chunk) {
        const photos_list = JSON.parse(item.photos_list);

        for (const photoObj of photos_list) {
          const itemCopy = Object.assign({}, item);

          itemCopy.photos_list = JSON.stringify([photoObj]);

          newChunk.push(itemCopy);
        }
      }

      return newChunk;
    });

    const output = [];

    for (let i = 0; i < splittedChunks.length; i++) {
      const resChunk = splittedChunks[i];
      const inputChunk = items[i];

      for (let x = 0; x < resChunk.length; x++) {
        const resItem = resChunk[x];
        const inputItem = inputChunk[x];
        
        if (inputItem.hasOwnProperty('caption')) {
          resItem.caption = inputItem.caption;
        }
      }
      
      output.push({ loader: fetchChunks[i].loader, responses: resChunk });
    }

    return output;
  }

  
  static async makeFormdatas(items, imgsPath) {
    const output = [];
    const chunkedItems = [].concat.apply([], 
    items.map(function(elem, i) {
      return i % 1 ? [] : [items.slice(i, i + 1)];
    })); // divide by 1 due to VK restrictions (uploading photos with unique captions)

    for (const chunk of chunkedItems) {
      const formData = new FormData();
      output.push(formData);

      for (let i = 0; i < chunk.length; i++) {
        const item = chunk[i];
        const imgPath = imgsPath + '/' + item.filename; 
        
        await fsAccess(imgPath); // try to access

        const buffer = fs.createReadStream(imgPath);
        formData.append(`file${i + 1}`, buffer);
      }
    }

    return output;
  }
}
