var binarySearch = require("./../Utility/binarySearch.js")
  , ndn
  , debug = {};
debug.debug = require("debug")("PIT");


function pubKeyMatch (ar1, ar2){
  if (!ar1){
    return true;
  }

  for(var i = 0; i < ar1.length; i++ ){
    if (ar1[i] !== ar2[i]){
      return false;
    }
  }
  return true;
}

/**PIT Entry
 *@constructor
 *@param {Buffer} element The raw interest data packet
 *@param {Object=} interest the ndn.Interest Object
 *@param {number|function} faceIDorCallback Either the faceID of the face this interest was received on, or a callback function to receive any matching data
 *@returns {PitEntry} - the entry
 */
function PitEntry (element, interest, faceIDorCallback){
  if (typeof interest !== "object"){
    faceIDorCallback = interest;
    interest = new ndn.Interest();
    interest.wireDecode(element);
  }
  if (!interest.nonce){
    interest.wireDecode(element);
  }
  debug.debug("constructing entry for %s", interest.toUri());
  this.nonce = interest.nonce;
  this.uri = interest.name.toUri();
  this.interest = interest;
  this.element = element;
  if (typeof faceIDorCallback === "function" ){
    this.callback = faceIDorCallback;
  } else {
    this.faceID = faceIDorCallback;
  }
  return this;
}

/**Test whether the PitEntry is fulfilled by a data object
 *@param {Object} data the ndn.Data object
 *@returns {Boolean}
 */
PitEntry.prototype.matches = function(data){
  debug.debug("checking if %s matches %s", this.interest.name.toUri(), data.name.toUri());
  if (this.interest.matchesName(data.name)
     && pubKeyMatch(this.interest.publisherPublicKeyDigest, data.signedInfo.publisher.publisherPublicKeyDigest)
     ){
    debug.debug("entry matches");
    return true;
  } else {
    debug.debug("entry does not match");
    return false;
  }
};

/**Consume the PitEntry (assuming it is attached to a the nameTree)
 *@returns {PitEntry} in case you want to do anything with it afterward
 */
PitEntry.prototype.consume = function(callbackCalled) {
  debug.debug("consuming entry %s", this.uri);
  if (this.nameTreeNode){
    var i = binarySearch(this.nameTreeNode.pitEntries, this, "nonce");
    if (i >= 0){
      var removed = this.nameTreeNode.pitEntries.splice(~i, 1)[0];
      if (removed.callback && !callbackCalled){
        debug.debug("executing PITEntry Callback %s", removed.callback.toString());
        removed.callback(null, removed.interest);
      }
    }
  }
  return this;
};




/**Pending Interest Table
 *@constructor
 *@param {NameTree} nameTree the nameTree to build the table on top of
 *@returns {PIT} a new PIT
 */
var PIT = function PIT(nameTree){
  this.nameTree = nameTree;
  return this;
};

/**Import ndn-lib into the PIT scope
 *@param {Object} NDN the NDN-js library in object form
 */
PIT.installNDN = function(NDN){
  ndn = NDN;
  return this;
};

PIT.Entry = PitEntry;

PIT.prototype.useNameTree = function(nameTree){
  this.nameTree = nameTree;
  return this;
};

/**Create and insert a new {@link PITEntry}
 *@param {Buffer} element The raw interest data packet
 *@param {Object=} interest the ndn.Interest object
 *@param {Number|function} faceIDorCallback either a numerical faceID or a callbackFunction
 *@returns {PIT} the PIT (for chaining)
 */
PIT.prototype.insertPitEntry = function(element, interest, faceIDorCallback){
  var pitEntry = new PIT.Entry(element, interest, faceIDorCallback);
  debug.debug("inserting pit entry %s with lifetime milliseconds %s",pitEntry.interest.toUri(), pitEntry.interest.getInterestLifetimeMilliseconds() );
  setTimeout(function(){
    debug.debug("entry %s expired after %s ms", pitEntry.uri, pitEntry.interest.getInterestLifetimeMilliseconds());
    pitEntry.consume();
  }, pitEntry.interest.getInterestLifetimeMilliseconds() || 10);
  var node = this.nameTree.lookup(pitEntry.interest.name);

  var i = binarySearch(node.pitEntries, pitEntry, "nonce");
  if (i < 0){
    pitEntry.nameTreeNode = node;
    node.pitEntries.splice(~i, 0 ,pitEntry);
  }
  return this;
};

PIT.prototype.checkDuplicate = function(interest){
  debug.debug("checking interest %s for duplicate", interest.toUri());
  var node = this.nameTree.lookup(interest.name);

  var i = binarySearch(node.pitEntries, interest, "nonce");

  if (i < 0){
    debug.debug("%s is not duplicate", interest.toUri());
    return false;
  } else {
    debug.debug("%s is duplicate", interest.toUri());
    return true;
  }

};

/**Lookup the PIT for Entries matching a given data object
 *@param {Object} data The ndn.Data object
 *@returns {Object} results: an object with two properties, pitEntries and faces, which are
 * an array of matching {@link PITEntry}s and
 * an integer faceFlag for use with {@link Interfaces.dispatch}, respectively.
 */
PIT.prototype.lookup = function(data, name, matches, faceFlag){
  name = name || data.name;
  matches = matches || [];
  faceFlag = faceFlag || 0;
  debug.debug("lookup entries for %s", name.toUri());

  var pitEntries = this.nameTree.lookup(name).pitEntries;

  for (var i = 0; i < pitEntries.length; i++){
    if (pitEntries[i].matches(data)){
      debug.debug("found match %s", pitEntries[i].uri);
      matches.push(pitEntries[i]);
      if (pitEntries[i].faceID){
        faceFlag = faceFlag | (1 << pitEntries[i].faceID);
      }
    }
  }

  if (name.size() > 0){
    return this.lookup(data, name.getPrefix(-1), matches, faceFlag);
  } else{
    return {pitEntries : matches, faces : faceFlag};
  }
};

module.exports = PIT;
