var PIT = require("../src/DataStructures/PIT.js");
var assert = require("assert")
var ndn = require("ndn-js")

describe("PIT", function(){
  describe("Node",function(){
    describe("constructor",function(){

    })
  })

  describe("insert(interest)",function(){
    var pit = new PIT()
    it("should return a Promise", function(done){
      var interest = new ndn.Interest(new ndn.Name("test/pit/insert/promise"));
      console.log(pit)
      pit.insert(interest)
         .then(function(){
           done()
         })
        .catch(function(){
          done()
        })
    })

    it("should resolve with interest", function(done){
      done()
    })

    it("should reject if duplicate", function(done){
      done()
    })

    it("should reject if no lifetime", function(done){
      done()
    })

    it("should autoremove after timeout", function(done){
      done()
    })
  })

  describe("lookup(data)",function(){
    it("should return a Promise", function(done){
      done()
    })
    it("should resove with all matching   entries", function(done){
      done()
    })

    it("should reject if no matching entries", function(done){
      done()
    })

    it("should consume matched entries", function(done){
      done()
    })
  })
})
