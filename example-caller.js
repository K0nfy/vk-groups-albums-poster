const VkAlbPoster = require('./index.js');

const vkAlbPoster = new VkAlbPoster({
  group_id: '195251462', // ID группы
  tokens: [ // токены аккаунтов, которые имеют права на загрузку в альбомы указанной группы
    'cad9f50c062409b3eb815267bd878aa7b7be69051e37153783f112689a959624',
    '59e8b6780ad7ac0784342b67b2fd345c2ef7d6c7d0b3b19cfb177968862067e2'
  ],
  options: {
    customDelays: { // в секундах
    // Если вы столкнулись с 9 ошибкой API - flood control, попробуйте повысить это значение и 
    // сделать запуск с новым токеном другого аккаунта 
    // Токены аккаунта, который столкнулся с данной ошибкой, могут быть забанены API на несколько часов
    // extra: 0, // По-умолчанию: 0. Рекомендуемый шаг - 30

    // Укажите свою задержку вместо автоматической из таблицы (подробнее в документации)
    // Складывается с extra
    // constant: 100 // По-умолчанию: зависит от входных данных
    }
  }
});

vkAlbPoster
  .post({
    albums: [
      {
        name: 'test_10',
        imgsPath: './input_example/60pcs/pics',
        descrsPath: './input_example/60pcs/descriptions60.json',
        logFilePath: './input_example/60pcs/' // если этот параметр указан, скрипт сделает лог-файл
      },
      // { // можно грузить сразу несколько альбомов! Грузится будут по очереди
      //   name: 'test_11',
      //   imgsPath: './input_example/1pc-1px',
      //   descrsPath: './input_example/1pc-1px/descriptions200.json'
      // }
    ]
  })
  .then(console.log)
  .catch(console.error);
