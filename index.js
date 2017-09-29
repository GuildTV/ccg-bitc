const osc = require("osc");
const WebSocket  = require('ws');
const express = require('express');
const os = require("os");
const { CasparCG, ConnectionOptions, AMCP } = require("casparcg-connection");

const TARGETLAYER = 10;
const BINDPORT = 8081;

const connection = new CasparCG(new ConnectionOptions ({
  autoReconnect: true,
  autoReconnectInterval: 10000,

  //debug: true,
  // onConnected: loadInfo,
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
var udpPort = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: 5253
});

udpPort.on("ready", function () {
  const ipAddresses = getIPAddresses();
  console.log("Listening for OSC over UDP.");
  ipAddresses.forEach(function (address) {
    console.log(" Host:", address + ", Port:", udpPort.options.localPort);
  });
  console.log("To start the demo, go to http://127.0.0.1:"+BINDPORT+" in your web browser.");

  connection.playHtmlPage(1, 100, "http://127.0.0.1:"+BINDPORT+"/index.html");
  // TODO - layer routing?
});

var active = {
  current: 0,
  total: 0,
  name: null,
  fps: 0
};

function pplt10(v) {
  return (v < 10 && v >= 0) ? ('0'+v) : v;
}

function pptc(t) {
  if (typeof t.h !== 'undefined') {
    return t.h + ":" + pplt10(t.m) + ":" + pplt10(t.s) + ":" + pplt10(t.f);
  }
  else {
    return pplt10(t.m) + ":" + pplt10(t.s) + ":" + pplt10(t.f);
  }
}

function parseBlock(block) {
  if (block.name === null)
    return { top: "Player", bottom: "empty" };

  if (block.current == -1)
    return null;
  
  var cs = Math.floor(block.current / block.fps);
  var cm = Math.floor(cs / 60);
  var ch = Math.floor(cm / 60) + 10;

  cs = cs % 60;
  cm = cm % 60;

  var cf = (block.current % block.fps);

  var rs = Math.floor((block.total - block.current) / block.fps);
  var rm = Math.floor(rs / 60);
  var rf = ((block.total - block.current) % block.fps);

  rs = rs % 60;
  rm = rm % 60;

  return { top: pptc({h: ch, m: cm, s: cs, f: cf}) + "&nbsp;&nbsp;" + pptc({m: rm, s:rs, f:rf}), bottom: block.name };
}

var sockets = [];

function sendTheThing() {
  toSend = parseBlock(active);
  if (toSend == null)
    return;

  toSend = JSON.stringify(toSend);

  var socketsToRemove = [];

  for(var i = 0; i < sockets.length; i++) {
    sockets[i].send(toSend, function ack(error) {
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
  if (active.paused)
    return;
  
  active.total = 0;
  active.current = 0;
  active.fps = 0;
  active.name = null;
  
  sendTheThing();
}

udpPort.on("message", function(message) {
  // console.log(message.address)
  if(message.address === "/channel/1/stage/layer/"+TARGETLAYER+"/paused") {
    active.paused = message.args[0]
    
    if (active.paused) {
      if (resetTimeout != null)
      clearTimeout(resetTimeout);
    
      resetTimeout = setTimeout(clearState, 1000);
    }
  }
  else if(message.address === "/channel/1/stage/layer/"+TARGETLAYER+"/frame") {
    //console.log(message);
    //console.log("reporting " + message.args[0].low + " of " + message.args[1].low);
    // console.log(message.args)
    active.current = message.args[0].low ;//- 1; // TODO - why is this -2? is causing issues!
    active.total = message.args[1].low;
    //console.log(active.current + " " + active.total);
    sendTheThing();
  }
  else if(message.address === "/channel/1/stage/layer/"+TARGETLAYER+"/file/fps") {
    active.fps = message.args[0];
    sendTheThing();
  }
  else if(message.address === "/channel/1/stage/layer/"+TARGETLAYER+"/file/path") {
    if (resetTimeout != null)
      clearTimeout(resetTimeout);
    
    resetTimeout = setTimeout(clearState, 1000);
  
    //console.log(message);
    active.name = message.args[0].slice(0,-4).substring(0, 35);
    sendTheThing();
  }
});

udpPort.open();

// Create an Express-based Web Socket server to which OSC messages will be relayed.
var appResources = __dirname + "/web",
    app = express(),
    server = app.listen(BINDPORT),
    wss = new WebSocket.Server({
        server: server
    });

app.use("/", express.static(appResources));

wss.on("connection", function (socket) {
  console.log("A Web Socket connection has been established!");
  sockets.push(socket);
});

