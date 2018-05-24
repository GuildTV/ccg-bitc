const osc = require("osc");
const WebSocket  = require('ws');
const path = require('path');
const express = require('express');
const os = require("os");
const { CasparCG, ConnectionOptions, AMCP } = require("casparcg-connection");

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
  connection.clear(config.output.channel);
  connection.playHtmlPage(config.output.channel, 100, "http://127.0.0.1:"+config.http.port+"/index.html");
  connection.play(config.output.channel, 90, "route://"+config.source.channel+"-"+config.source.layer);
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

oscClient.on("message", function(message) {
  if(message.address === "/channel/"+config.source.channel+"/stage/layer/"+config.source.layer+"/paused") {
    active.paused = message.args[0]
    
    if (active.paused) {
      if (resetTimeout != null)
      clearTimeout(resetTimeout);
    
      resetTimeout = setTimeout(clearState, 150);
    }
  }
  else if(message.address === "/channel/"+config.source.channel+"/stage/layer/"+config.source.layer+"/file/frame" || message.address === "/channel/"+config.source.channel+"/stage/layer/"+config.source.layer+"/frame") {
    active.current = message.args[0].low ;//- 1; // TODO - why is this -2? is causing issues!
    active.total = message.args[1].low;
    sendTheThing();
  }
  else if(message.address === "/channel/"+config.source.channel+"/stage/layer/"+config.source.layer+"/file/fps") {
    active.fps = message.args[0];
    sendTheThing();
  }
  else if(message.address === "/channel/"+config.source.channel+"/stage/layer/"+config.source.layer+"/file/path") {
    if (resetTimeout != null)
      clearTimeout(resetTimeout);
    
    resetTimeout = setTimeout(clearState, 150);
  
    active.name = message.args[0].slice(0,-4).substring(0, 35);
    sendTheThing();
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
console.log("Press any key to reinitialise the overlay")