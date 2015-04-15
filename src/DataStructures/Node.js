var Repository = require("./Repository.js")
  , ContentStore = require("./ContentStore.js")
  , PIT = require("./PIT.js")
  , FIB = require("./FIB.js")
  , getFileChunks = require("./util/get-file-chunks.js")
  , Name = require("ndn-js/js/name.js").Name
  , Data = require("ndn-js/js/data.js").Data
  , Interest = require("ndn-js/js/interest").Interest;

function Node (){
  this._contentStore = new ContentStore();
  this._pit = new PIT();
  this._fib = new FIB();
}

Node.create = function Node_create(path){
  var node = new Node();
  if (path)
    Repository.Open(path)
              .then(function Node_create_Repository_Open(repo){
                node._repository = repo;
                return node;
              })
  else
    return new Promise(function Node_create_no_repository(){
      resolve(new Node());
    })
}

Node.prototype.onData = function Node_onData(data, face){
  var self = this;
  self._pit
      .lookup(data, face)
      .then(function Node_onData_pitResults(faceArray){
        for (var i in faceArray)
          faceArray[i].putData(data);

        return self._contentStore.insert(data);
      })
      .catch(function(err){
        console.log("error in Node data path:", err, err.stack)
      })

}

Node.prototype.onInterest = function Node_onInterest(interest, face){
  var self = this;

  self._contentStore
      .lookup(interest)
      .then(function Node_onInterest_ContentStore_Hit(data){
        face.putData(data);
      })
      .catch(function Node_onInterest_ContentStore_Miss(interest){
        return self._repository.lookup(interest);
      })
      .then(function Node_onInterest_Repository_Hit(data){
        face.putData();
      })
      .catch(function Node_onInterest_Repository_Miss(){
        return self._fib.lookup(interest);
      })
      .then(function Node_onInterest_FIB_Hit(nextHops){
        //TODO: turn this into a call to strategy
        self._pit
            .insert(interest, function PITonData(data, responderFace){
              return face;
            })
            .then(function Node_onInterest_PIT_inserted(interest){
              for (var i in nextHops)
                nextHops[i].putData(interest);
            });
      })
      .catch(function Node_onInterest_FIB_Miss(err){
        //TODO: NACK
      });
}

function chunkIterator(){
  this.curr = 0;
}

chunkIterator.prototype.next = function chunkIterator_next(){
  var self = this;
  this.curr++;
  var done = (self.length === 0);
  var chunkNumber = this.curr - 1;

  var next = (!done) ? new Promise(function (resolve, reject){
                        resolve(self.shift(), chunkNumber);
                       })
                     : null;
  return {
    next: next
    ,done: done
  }
}

Node.getStringChunks = function getStringChunks(string){
  return new Promise(function getStringChunks_Promise(resolve,reject){
    var chunks = [];


    chunks[Symbol.iterator] = chunkIterator.bind(chunks)
    while (string.length > 0){
      chunks.push(string.substr(0,8000));
      string = string.substr(8000, string.length);
    }

    resolve(chunks);
  })
}

Node.getBufferChunks = function getBufferChunks(buffer){
  return new Promise(function getBufferChunks_Promise(resolve,reject){
    var chunks = [];
    var i = 0;

    chunks.numberOfChunks = MatH.ceil(buffer.length / 8000)

    chunks[Symbol.iterator] = chunkIterator.bind(chunks);

    while (i*8000 < buffer.length)
      chunks.push(buffer.slice(i*8000, (i+1)*8000))
    resolve(chunks);
  })
}

Node.prototype.putPacket = function Node_putPacket(data, store){
  var self = this;
  return Promise.all([
    store.insert(data)
    , self._pit
          .lookup(data)
          .then(function Node_putPacket_PIT_Hit(faces){
            for (var i in faces)
              faces[i].putData(data);
          })
          .catch(function Node_putPacket_PIT_Miss(er){
            return false;
          })
    ]);
};

Node.prototype.put = function Node_put(param, store){
  var self = this
    , store = store || this._contentStore
    , type = param.type
    , data = param.data
    , versioned = param.versioned
    , prefix    = new Name(param.prefix)
    , freshnessPeriod = param.freshnessPeriod;

  return new Promise(function Node_put_Promise(resolve,reject){
    if (!(type && data && param.prefix))
      return reject(new Error("Node.put(param): param must include type, data, and prefix fields"))

    if (versioned)
      prefix.appendVersion(Date.now())

    var chunkify;
    if (type === "json"){
      chunkify = getStringChunks(JSON.stringify(data));
    } else if (type === "string") {
      chunkify = getStringChunks(data);
    } else if (type === "file"){
      chunkify = getFileChunks(data);
    } else if (type === "buffer"){
      chunkify = getBufferChunks();
    } else {
      return reject(new Error("Node.put(param): param.type must be json, string, file, or buffer"))
    }

    chunkify.then(function Node_put_processChunks(chunks){
      var name = new Name(prefix);
      name.appendSegment(0);
      var data0 = new Data(name, JSON.stringify(param));
      data0.getMetaInfo().setFreshnessPeriod(freshnessPeriod);
      data0.getMetaInfo().setFinalBlockID(
                            new Name.Component(Name.Component.fromNumberWithMarker(chunks.length, 0x00))
                          )

      var proms = [
        self.putPacket(data0, store)
      ];

      for (var chunk of chunks){
        proms.push(chunk.then(function onChunk(buffer, chunkNumber){
          var name = new Name(prefix);
          name.appendSegment(chunkNumber+1);
          var data = new Data(name, buffer);

          return self.putPacket(data, store);
        }));
      }

      Promise.all(proms)
             .then(function Node_put_Promise_Resolve(){
               resolve();
             })
             .catch(function Node_put_Promise_Reject(err){
               reject(err);
             })

    });
  });
};

Node.prototype.expressInterest = function Node_expressInterest(interest){
  var self = this;
  var t = Date.now()
  return new Promise(function Node_expressInterest_Promise(resolve,reject){
    var nexthops;
    self._fib
        .lookup(interest)
        .then(function Node_expressInterest_FIB_Hit(res){
          nexthops = res
          return self._pit.insert(interest, function Node_expressInterest_onData(data, respondFace){
            if (data === interest)
              reject(new Error("Node.expressInterest timeoout"), interest);
            else
              resolve(data, respondFace, Date.now() - t);
          });
        }).catch(function Node_expressInterest_FIB_Miss(err){
          reject(err, interest)
        }).then(function Node_expressInterest_PitInsert(pit){
          for (var i in nexthops)
            nexthops[i].putData(interest);
        });
  });
}

Node.prototype.pipelineFetch = function Node_pipelineFetch(data0, roundtriptime){
  var pipe = [];
  var numberOfPackets = data0.getMetaInfo().getFinalBlockID().toSegment() + 1;
  var millisecondsPerPacket = this.getMaximumPacketSendTime() || 200;
  var timeToExpectedLastPacket = (millisecondsPerPacket * numberOfPackets) + roundtriptime;

  for (var i = 0; i < numberOfPackets; i++  ){
    pipe[i] = new Interest(data0.name.getPrefix(-1).appendSegment(0));
    pipe[i].setInterestLifetimeMilliseconds(timeToExpectedLastPacket);
    pipe[i].setMinSuffixComponents(1);
    pipe[i].setMaxSuffixComponents(1);
    pipe[i] = this.expressInterest(interest)
                  .then(function(data, face, rtt){
                    return data;
                  });
  }

  return Promise.all(pipe);
}

Node.prototype.fetch = function Node_fetch(params){
  var prefix    = new Name(params.prefix)
    , versioned = params.versioned
    , chained = params.chained
    , self = this;

  var firstInterest = new Interest(prefix)
  firstInterest.setInterestLifetimeMilliseconds(4000)
  var minSuffix = (versioned) ? 3 : 2;
  var maxSuffix = minSuffix;
  var childSelector = (versioned) ? 1 : 0;

  firstInterest.setMinSuffixComponents(minSuffix);
  firstInterest.setMaxSuffixComponents(maxSuffix);
  firstInterest.setChildSelector(childSelector);

  return self.expressInterest(firstInterest )
             .then(function(data, face, roundTripTime){
               return self.pipelineFetch(data, roundTripTime)
             })
             .catch(function(err){
               reject(err);
             });
}

Node.prototype.get = function Node_get(params){
  return this.fetch(params)
             .then(function (datas){
               return Node.assemble(datas);
             });
}

Node.prototype.store = function Node_store(params){
  return this.put(params, this._repository)
}

Node.prototype.steward = function Node_steward(params){
  var self = this;
  return this.fetch(params)
             .then(function(datas){
               var proms = []
               for (var i in datas)
                 proms.push(self._repository.insert(datas[i]))
               return Promise.all(proms);
             });
}

Node.prototype.addConnectionMethod = function Node_addConnectionMethod(method){

}
