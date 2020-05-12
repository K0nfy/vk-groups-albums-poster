const fs = require('fs');
const dateFormat = require('dateformat');

module.exports = class LogStream {
  constructor(path) {
    if (!path && path !== '') { return }

    const currentDate = dateFormat(Date.now(), 'dd.mm.yyyy--HH-MM-ss');
    const logFileName = `log--${currentDate}.json`;
    const logFileFullPath = path + '/' + logFileName;

    this.instance = fs.createWriteStream(logFileFullPath);
  }

  end() {
    if (this.instance) { this.instance.end() }
  }

  write(data) {
    if (this.instance) { this.instance.write(data) }
  }
}
