var abstract = require("./Abstract.js")
var tcpServer = require("../../../src/Transports/node/TCPServer.js")
var assert = require("assert")
var net = require("net")

function TCPTest (Transport){
  describe("Listener", function(){
    it("should listen on default port", function(done){
      Transport.Listener({
        newFace: function(){
          done();
        }
      })
      var c = net.connect({port: 8484}, function(){
        assert(c)
      })
    })
  })
}

abstract(tcpServer, TCPTest)
