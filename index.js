const osc = require("osc");
const WebSocket  = require('ws');
const express = require('express');
const os = require("os");
const { CasparCG, ConnectionOptions } = require("casparcg-connection");

const config = require('./config')

const connection = new CasparCG(new ConnectionOptions ({
  host: config.caspar.host,
  port: config.caspar.port,

  autoReconnect: true,
  autoReconnectInterval: 10000,
}));

function getIPAddresses() {
  const interfaces = os.networkInterfaces();
  const ipAddresses = [];

  for (var deviceName in interfaces) {
    var addresses = interfaces[deviceName];
    for (let addressInfo of addresses) {
      if (addressInfo.family === "IPv4" && !addressInfo.internal) {
        ipAddresses.push(addressInfo.address);
      }
    }
  }

  return ipAddresses;
}

// Bind to a UDP socket to listen for incoming OSC events.
const oscClient = new osc.UDPPort({
  localAddress: "0.0.0.0",
  localPort: config.osc.port
});

function launchOverlay(){
  connection.clear(config.output.channel).catch(() => {
    console.error("Failed to clear output channel")
  });
  connection.playHtmlPage(config.output.channel, 100, "http://127.0.0.1:"+config.http.port+"/index.html").catch(() => {
    console.error("Failed to clear output overlay")
  });
  connection.play(config.output.channel, 90, "route://"+config.source.channel+"-"+config.source.layer).catch(() => {
    console.error("Failed to play output route")
  });
}

oscClient.on("open", function () {
  const ipAddresses = getIPAddresses();
  console.log("Listening for OSC over UDP.");
  ipAddresses.forEach(function (address) {
    console.log(" Host:", address + ", Port:", config.osc.port);
  });
  console.log("Overlay is available at http://127.0.0.1:"+config.http.port+" in your web browser.");

  launchOverlay();
});

const currentState = {
  current: 0,
  total: 0,
  name: null,
  fps: 0
};

function padStr(v, ch, len) {
  let str = `${v}`
  while (str.length < len) {
    str = `${ch}${str}`
  }
  return str
}

function formatTimecode(t) {
  const str = `${padStr(t.m, '0', 2)}:${padStr(t.s, '0', 2)}.${padStr(t.f, '0', 3)}`
  if (typeof t.h !== 'undefined') {
    return `${t.h}:${str}`;
  }
  else {
    return str
  }
}

function processState(block) {
  if (block.name === null)
    return { top: "Player", bottom: "empty" };

  if (block.current == -1)
    return null;

 
  if (block.fps === 0) {
    const calcTimings = (time, useHours) => {
      const seconds = Math.floor(time);
      const milliseconds = Math.floor((time - seconds) * 1000);
      const minutes = Math.floor(seconds / 60)
      const hours = useHours ? Math.floor(minutes / 60) + 10 : undefined

      return formatTimecode({h: hours, m: minutes % 60, s: seconds % 60, f: milliseconds})
    }

    return {
      top: calcTimings(block.current, true) + "&nbsp;&nbsp;" + calcTimings(block.total - block.current),
      bottom: block.name
    };
  } else {
    const calcTimings = (time, useHours) => {
      const cs = Math.floor(time / block.fps)
      const cm = Math.floor(cs / 60)
      const ch = useHours ? Math.floor(cm / 60) + 10 : undefined
      const cf = (time % block.fps);

      return formatTimecode({h: ch, m: cm % 60, s: cs % 60, f: cf})
    }

    return {
      top: calcTimings(block.current, true) + "&nbsp;&nbsp;" + calcTimings(block.total - block.current),
      bottom: block.name
    };
  }
}

var sockets = [];

function emitState() {
  const toSend = processState(currentState);
  if (toSend == null)
    return;

  const toSendStr = JSON.stringify(toSend);

  var socketsToRemove = [];

  for(var i = 0; i < sockets.length; i++) {
    sockets[i].send(toSendStr, function ack(error) {
      if(typeof error !== 'undefined') {
        console.log("Socket error: " + error);
        socketsToRemove.push(i);
      }
   });
  }

  for(s of socketsToRemove) {
    sockets.splice(s, 1);
  }
}

var resetTimeout = null;

function clearState(){
  if (currentState.paused)
    return;
  
  currentState.total = 0;
  currentState.current = 0;
  currentState.fps = 0;
  currentState.name = null;
  
  emitState();
}

oscClient.on("message", function(message) {
  // console.log(message.address)
  if(message.address === "/channel/"+config.source.channel+"/stage/layer/"+config.source.layer+"/paused") {
    currentState.paused = message.args[0]
    
    if (currentState.paused) {
      if (resetTimeout != null)
      clearTimeout(resetTimeout);
    
      resetTimeout = setTimeout(clearState, 150);
    }
  }
  else if(message.address === "/channel/"+config.source.channel+"/stage/layer/"+config.source.layer+"/file/frame" || message.address === "/channel/"+config.source.channel+"/stage/layer/"+config.source.layer+"/frame") {
    currentState.current = message.args[0].low ;//- 1; // TODO - why is this -2? is causing issues!
    currentState.total = message.args[1].low;
    emitState();
  }
  else if(message.address === `/channel/${config.source.channel}/stage/layer/${config.source.layer}/foreground/file/time`) {
    currentState.current = message.args[0];
    currentState.total = message.args[1];
    currentState.fps = 0;

    emitState();
  }
  else if(message.address === "/channel/"+config.source.channel+"/stage/layer/"+config.source.layer+"/file/fps") {
    currentState.fps = message.args[0];
    emitState();
  }
  else if(message.address === "/channel/"+config.source.channel+"/stage/layer/"+config.source.layer+"/file/path" || message.address === `/channel/${config.source.channel}/stage/layer/${config.source.layer}/foreground/file/name`) {
    if (resetTimeout != null)
      clearTimeout(resetTimeout);
    
    resetTimeout = setTimeout(clearState, 150);
  
    currentState.name = message.args[0].slice(0,-4).substring(0, 35);
    emitState();
  }
});

oscClient.open();

// Create an Express-based Web Socket server to which OSC messages will be relayed.
const app = express();
const server = app.listen(config.http.port);
const wss = new WebSocket.Server({
    server: server
});

app.use(express.static('web'));

wss.on("connection", function (socket) {
  console.log("A client as connected!");
  sockets.push(socket);
});

const stdin = process.openStdin()
stdin.resume();
stdin.on('data', launchOverlay);
console.log("Press enter to reinitialise the overlay")