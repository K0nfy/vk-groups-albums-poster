'use strict';

const VK = require('vk-io').VK;

module.exports = class ApiCallers {
  constructor(tokens) {
    const queue = this.recursiveQueue = tokens.slice();
    const list = this.list = {}; // ApiCallers.list

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const entry = list[token] = {};
      
      if (!/[a-zA-Z0-9]/.test(token)) { throw new Error(`Wrong token: ${token}`) }
      
      entry.apiCaller = new VK();
      entry.apiCaller.token = entry.token = token;

      entry.lastSaveCallTime = -Infinity;
    }

    this.queueNext = 0;
  }

  next() {
    const current = this.queueNext;
    const keysList = this.recursiveQueue;
    const currentKey = keysList[current];

    if (++this.queueNext > keysList.length - 1) { this.queueNext = 0 }

    return this.list[currentKey];
  }
}
