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

  // connection.playHtmlPage(2, 100, "http://127.0.0.1:"+BINDPORT+"/index.html");
  // TODO - layer routing?
});

var activeChannels = {};

function getActiveChannel(id){
  var res = activeChannels[id];
  if (res !== undefined)
    return res;
  
  return activeChannels[id] = {
    id: id,
    current: 0,
    total: 0,
    name: null,
    fps: 0
  };
}

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
    return { id: block.id, top: "Player", bottom: "empty" };

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

  return { id: block.id, top: pptc({h: ch, m: cm, s: cs, f: cf}) + "&nbsp;&nbsp;" + pptc({m: rm, s:rs, f:rf}), bottom: block.name };
}

var sockets = [];

function sendAllData() {
  var keys = Object.keys(activeChannels);
  for (var o=0; o<keys.length;o++){
    var id = keys[o];
    var active = getActiveChannel(id);

    var toSend = parseBlock(active);
    if (toSend == null)
      continue;

    toSend = JSON.stringify(toSend);

    if (active.lastSent == toSend)
      continue;

    active.lastSent = toSend;

    var socketsToRemove = [];

    for(var i = 0; i < sockets.length; i++) {
      sockets[i].send(toSend, function ack(error) {
        if(typeof error !== 'undefined') {
          console.log("Socket error: " + error);
          socketsToRemove.push(i);
        }
     });
    }

    for(var s of socketsToRemove) {
      sockets.splice(s, 1);
    }
  }
}

var resetTimeouts = {};

function clearState(id){
  var active = getActiveChannel(id);
  if (active.paused)
    return;
  
  active.total = 0;
  active.current = 0;
  active.fps = 0;
  active.name = null;
  
  sendAllData();
}

function queueClearState(id){
  if (resetTimeouts[id] != null && resetTimeouts[id] != undefined)
    clearTimeout(resetTimeouts[id]);
    
  resetTimeouts[id] = setTimeout(function(){
    clearState(id);
  }, 1000);
}

udpPort.on("message", function(message) {
  if (message.address.indexOf("/channel/") != 0)
    return;
  
  var addr2 = message.address.substring(9);
  var id = parseInt(addr2.substring(0, addr2.indexOf("/")))
  if (isNaN(id))
    return;

  var active = getActiveChannel(id);
  
  if(message.address === "/channel/"+id+"/stage/layer/"+TARGETLAYER+"/paused") {
    active.paused = message.args[0]
    
    if (active.paused)
      queueClearState(id);
  }
  else if(message.address === "/channel/"+id+"/stage/layer/"+TARGETLAYER+"/file/frame") {
    active.current = message.args[0].low;
    active.total = message.args[1].low;
    sendAllData();
  }
  else if(message.address === "/channel/"+id+"/stage/layer/"+TARGETLAYER+"/file/fps") {
    active.fps = message.args[0];
    sendAllData();
  }
  else if(message.address === "/channel/"+id+"/stage/layer/"+TARGETLAYER+"/file/path") {
    queueClearState(id);
  
    active.name = message.args[0].slice(0,-4).substring(0, 35);
    sendAllData();
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

