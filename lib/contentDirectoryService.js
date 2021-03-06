/*jslint node: true, vars: true, nomen: true */
"use strict";

var Service = require("./service");
var Async = require("async");
var Util = require('util');
var fs = require('fs');
var Item = require('./item');
var Mime = require('mime');
var Path = require('path');
var jstoxml = require('jstoxml');
var logger = require('./logger');

function escapeXml(xml) {
//	if (false) {
//		return xml.replace(/\&/g, "&amp;").replace(/\</g, "&lt;").replace(
//				/\>/g, "&gt;");
//	}

	return "<![CDATA[" + xml + "]]>";
}

var ContentDirectoryService = function () {
	Service.call(this, {
		serviceType : "urn:schemas-upnp-org:service:ContentDirectory:1",
		serviceId : "urn:upnp-org:serviceId:ContentDirectory",
		scpdURL : "/cds.xml",
		controlURL : "/cds/control",
		eventSubURL : "/cds/event"
	});

	this.addAction("Browse", [ {
		name : "ObjectID",
		type : "A_ARG_TYPE_ObjectID"
	}, {
		name : "BrowseFlag",
		type : "A_ARG_TYPE_BrowseFlag"
	}, {
		name : "Filter",
		type : "A_ARG_TYPE_Filter"
	}, {
		name : "StartingIndex",
		type : "A_ARG_TYPE_Index"
	}, {
		name : "RequestedCount",
		type : "A_ARG_TYPE_Count"
	}, {
		name : "SortCriteria",
		type : "A_ARG_TYPE_SortCriteria"
	} ], [ {
		name : "Result",
		type : "A_ARG_TYPE_Result"
	}, {
		name : "NumberReturned",
		type : "A_ARG_TYPE_Count"
	}, {
		name : "TotalMatches",
		type : "A_ARG_TYPE_Count"
	}, {
		name : "UpdateID",
		type : "A_ARG_TYPE_UpdateID"
	} ]);
	this.addAction("GetSortCapabilities", [], [ {
		name : "SortCaps",
		type : "SortCapabilities"
	} ]);
	this.addAction("GetSystemUpdateID", [], [ {
		name : "Id",
		type : "SystemUpdateID"
	} ]);
	this.addAction("GetSearchCapabilities", [], [ {
		name : "SearchCaps",
		type : "SearchCapabilities"
	} ]);
	this.addAction("Search", [ {
		name : "ContainerID",
		type : "A_ARG_TYPE_ObjectID"
	}, {
		name : "SearchCriteria",
		type : "A_ARG_TYPE_SearchCriteria"
	}, {
		name : "Filter",
		type : "A_ARG_TYPE_Filter"
	}, {
		name : "StartingIndex",
		type : "A_ARG_TYPE_Index"
	}, {
		name : "RequestedCount",
		type : "A_ARG_TYPE_Count"
	}, {
		name : "SortCriteria",
		type : "A_ARG_TYPE_SortCriteria"
	} ], [ {
		name : "Result",
		type : "A_ARG_TYPE_Result"
	}, {
		name : "NumberReturned",
		type : "A_ARG_TYPE_Count"
	}, {
		name : "TotalMatches",
		type : "A_ARG_TYPE_Count"
	}, {
		name : "UpdateID",
		type : "A_ARG_TYPE_UpdateID"
	} ]);

	this.addType("A_ARG_TYPE_BrowseFlag", false, "string", [ "BrowseMetadata",
			"BrowseDirectChildren" ]);
	this.addType("ContainerUpdateIDs", true, "string");
	this.addType("SystemUpdateID", true, "ui4");
	this.addType("A_ARG_TYPE_Count", false, "ui4");
	this.addType("A_ARG_TYPE_SortCriteria", false, "string");
	this.addType("A_ARG_TYPE_SearchCriteria", false, "string");
	this.addType("SortCapabilities", false, "string");
	this.addType("A_ARG_TYPE_Index", false, "ui4");
	this.addType("A_ARG_TYPE_ObjectID", false, "string");
	this.addType("A_ARG_TYPE_UpdateID", false, "ui4");
	this.addType("A_ARG_TYPE_Result", false, "string");
	this.addType("SearchCapabilities", false, "string");
	this.addType("A_ARG_TYPE_Filter", false, "string");

	this.repositories = [];
};

Util.inherits(ContentDirectoryService, Service);

module.exports = ContentDirectoryService;

ContentDirectoryService.prototype.initialize = function (upnpServer, callback) {

	var self = this;
	Service.prototype.initialize.call(this, upnpServer, function (error) {
		if (error) {
			return callback(error);
		}
		
		if (upnpServer.configuration.repositories) {
			self.setRepositories(upnpServer.configuration.repositories, callback);
		}
	});
};

ContentDirectoryService.prototype.setRepositories = function (value, callback) {

	this.repositories = [];

	var repositories = value.slice(0);
	repositories.sort(function (r1, r2) {
		return r1.mountPath.length - r2.mountPath.length;
	});

	var self = this;
	self.newItem(null, "root", Item.CONTAINER, true, function (error, item) {
		if (error) {
			return callback(error);
		}

		self.root = item;
		item.service = self;
		item.restricted = true;
		// item.addSearchClass(Item.AUDIO_FILE, true);
		// item.addSearchClass(Item.IMAGE_FILE, true);
		// item.addSearchClass(Item.VIDEO_FILE, true);

		logger.info("Adding " + repositories.length + " repositories");

		Async.eachSeries(repositories, function (repository, callback) {

			logger.info("Adding repository [" + repository.mountPath + "]");

			self.addRepository(repository, callback);

		}, function (error) {
			if (error) {
				return callback(error);
			}

			callback(null, self);
		});
	});
};

ContentDirectoryService.prototype.addRepository = function (repository, callback) {
	var self = this;
	repository.initialize(this, function (error) {
		if (error) {
			return callback(error);
		}

		self.repositories.push(repository);
		callback(null, repository);
	});
};

ContentDirectoryService.prototype.allocateItemsForPath = function (path,
		callback) {

	var ps = path.split("/");
	ps.shift(); // Ca doit commencer par /

	// logger.debug("Process ", ps);

	if (ps.length < 1 || !ps[0]) {

		return callback(null, this.root);
	}

	var self = this;
	Async.reduce(ps, this.root, function (parentItem, segment, callback) {

		parentItem.getChildByName(segment, function (error, item) {
			if (error) {
				return callback(error);
			}

			if (item) {
				item.virtual = true;

				// logger.debug("allocateItemsForPath(" + segment +
				// ")=>",item.itemId);
				return callback(null, item);
			}

			// logger.debug("allocateItemsForPath(" + segment+ ")=> NEW
			// CONTAINER");

			self.newContainer(parentItem, segment, null, function (error, item) {
				if (error) {
					return callback(error);
				}

				item.virtual = true;

				return callback(null, item);
			});
		});
	}, callback);
};

ContentDirectoryService.prototype.processSoap_GetSearchCapabilities = function (xml, request, response, callback) {

	this.responseSoap(response, "GetSearchCapabilities", {
		_name : "u:GetSearchCapabilitiesResponse",
		_attrs : {
			"xmlns:u" : this.type
		},
		_content : {
			SearchCaps : {}
		}
	}, callback);
};

ContentDirectoryService.prototype.processSoap_GetSortCapabilities = function (xml, request, response, callback) {

	this.responseSoap(response, "GetSortCapabilities", {
		_name : "u:GetSortCapabilitiesResponse",
		_attrs : {
			"xmlns:u" : this.type
		}
	}, callback);
};

ContentDirectoryService.prototype.processSoap_Browse = function (xml, request, response, callback) {
	function childNamed(xml, name) {
		var child = xml.childNamed(name);
		if (child) {
			return child;
		}

		var found;
		xml.eachChild(function (c) {
			found = childNamed(c, name);
			if (found) {
				return false;
			}
		});

		return found;
	}

	var browseFlag = null;
	var node = childNamed(xml, "BrowseFlag");
	if (node) {
		browseFlag = node.val;
	}

	var filter = null;
	node = childNamed(xml, "Filter");
	if (node) {
		filter = node.val;
	}

	var objectId = this.root.itemId;
	node = childNamed(xml, "ObjectID");
	if (node) {
		objectId = parseInt(node.val, 10);
	}
	if (objectId === 0) {
		objectId = this.root.itemId;
	}

	logger.info("CDS: Browse starting  (flags=" + browseFlag + ") of item " + objectId);

	var startingIndex = -1;
	node = childNamed(xml, "StartingIndex");
	if (node) {
		startingIndex = parseInt(node.val, 10);
	}

	var requestedCount = -1;
	node = childNamed(xml, "RequestedCount");
	if (node) {
		requestedCount = parseInt(node.val, 10);
	}

	var sortCriteria = null;
	node = childNamed(xml, "SortCriteria");
	if (node) {
		sortCriteria = node.val;
	}

	if (browseFlag === "BrowseMetadata") {
		return this.responseObject(response, request, objectId, filter,
				callback);
	}

	if (browseFlag === "BrowseDirectChildren") {
		return this.responseContainer(response, request, objectId, filter,
				startingIndex, requestedCount, sortCriteria, callback);
	}

	callback("Unknown browseFlag '" + browseFlag + "'");
};

ContentDirectoryService.prototype.responseObject = function (response, request,
		objectId, filter, callback) {

	logger.info("Request ObjectId=" + objectId);

	var self = this;
	this.upnpServer
		.getItemById(
			objectId,
			function (error, item) {

				if (error) {
					return callback(error);
				}
				if (!item) {
					return callback("CDS: BrowseObject Can not find item " + objectId);
				}
				logger.info("CDS: BrowseObject itemId=", item.itemId, " error=", error);

				var localhost = request.socket.localAddress;
				var localport = request.socket.localPort;

				var repositoryRequest = {
					contentURL : "http://" + localhost + ":"
							+ localport + self.upnpServer.contentPath,
					request : request
				};

				if (!item.toJXML) {
					logger.warn("ALERT not an item ", item);
					return callback("Not an item");
				}

				var itemXML = item.toJXML(repositoryRequest);

				var xmlDidl = {
					_name : "DIDL-Lite",
					_attrs : {
						"xmlns" : "urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/",
						"xmlns:dc" : "http://purl.org/dc/elements/1.1/",
						"xmlns:upnp" : "urn:schemas-upnp-org:metadata-1-0/upnp/",
						"xmlns:dlna" : "urn:schemas-dlna-org:metadata-1-0/"
					// "xmlns:dlna":
					// "urn:schemas-dlna-org:metadata-1-0/"
					},
					_content : itemXML
				};

				var didl = jstoxml.toXML(xmlDidl, {
					header : false,
					indent : " "
				});

				self.responseSoap(response, "Browse", {
					_name : "u:BrowseResponse",
					_attrs : {
						"xmlns:u" : self.type
					},
					_content : {
						Result : escapeXml(didl),
						NumberReturned : 1,
						TotalMatches : 1,
						UpdateID : item.itemUpdateId
					}
				}, function (error) {
					if (error) {
						return callback(error);
					}

					// logger.debug("CDS: Browse end " + containerId);
					callback(null);
				});
			}
		);
};

ContentDirectoryService.prototype.responseContainer = function (response,
		request, containerId, filter, startingIndex, requestedCount,
		sortCriteria, callback) {

	logger.debug("Request containerId=" + containerId + " filter=" + filter
			+ " startingIndex=" + startingIndex + " requestCount="
			+ requestedCount + " sortCriteria=" + sortCriteria);

	var self = this;
	this.upnpServer.getItemById(containerId, function (error, item) {

		if (error) {
			return callback(error);
		}
		if (!item) {
			return callback("CDS: Browser Can not find item " + containerId);
		}

		logger.debug("CDS: Browser itemId=", item.itemId, " error=", error);

		item.listChildren(function (error, list) {
			if (error) {
				logger.warn("Can not scan repositories: ", error);
				return callback(error);
			}

//			if (false) {
//				logger.debug("CDS: List itemId=", item.itemId, " path=",
//						item.path, " error=", error, " list=", list.length,
//						" startingIndex=", startingIndex, " requesteCount=",
//						requestedCount);
//			}

//			if (filter) {
//				// We can apply filters
//			}

			if (sortCriteria) {
				// We can make asked sort

				list = list.slice(0).sort(function (i1, i2) {
					var n1 = (i1.title || i1.name);
					var n2 = (i2.title || i2.name);

					if (n1 < n2) {
						return -1;
					}
					if (n2 > n1) {
						return 1;
					}

					return 0;
				});
			}

			var total = list.length;

			if (startingIndex > 0) {
				if (startingIndex > list.length) {
					list = [];
				} else {
					list = list.slice(startingIndex);
				}
			}
			if (requestedCount > 0) {
				list = list.slice(0, requestedCount);
			}

			var count = list.length;

			// logger.debug("Generate ", list);

			var lxml = [];

			var xmlDidl = {
				_name : "DIDL-Lite",
				_attrs : {
					"xmlns" : "urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/",
					"xmlns:dc" : "http://purl.org/dc/elements/1.1/",
					"xmlns:upnp" : "urn:schemas-upnp-org:metadata-1-0/upnp/",
					"xmlns:dlna" : "urn:schemas-dlna-org:metadata-1-0/"
				},
				_content : lxml
			};

			var localhost = request.socket.localAddress;
			var localport = request.socket.localPort;

			var repositoryRequest = {
				contentURL : "http://" + localhost + ":" + localport
						+ self.upnpServer.contentPath,
				request : request
			};

			list.forEach(function (item) {

				if (!item || !item.toJXML) {
					logger.warn("ALERT not an item ", item);
					return;
				}

				lxml.push(item.toJXML(repositoryRequest));
			});

			var didl = jstoxml.toXML(xmlDidl, {
				header : false,
				indent : " "
			});

			self.responseSoap(response, "Browse", {
				_name : "u:BrowseResponse",
				_attrs : {
					"xmlns:u" : self.type
				},
				_content : {
					Result : escapeXml(didl),
					NumberReturned : count,
					TotalMatches : total,
					UpdateID : item.itemUpdateId
				}
			}, function (error) {
				if (error) {
					return callback(error);
				}

				// logger.debug("CDS: Browse end " + containerId);
				callback(null);
			});

		});
	});
};

ContentDirectoryService.prototype.browseItem = function (item, callback) {
	var path = item.getItemPath();

	logger.debug("CDS: browseItem itemID=" + item.itemId + " path='" + path
		+ "' repositories.count=" + this.repositories.length);

	Async.reduce(this.repositories, [], function (list, repository, callback) {

		if (path.indexOf(repository.mountPath) !== 0) {

			logger.debug("CDS: browseItem repository mountPath="
				+ repository.mountPath + " path=" + path + " is not in mountpath");

			return callback(null, list);
		}

		logger.debug("CDS: browseItem repository mountPath=" + repository.mountPath);

		repository.browse(list, item, function (error, result) {
			if (error) {
				logger.error("CDS: browseItem repository mountPath="
						+ repository.mountPath + " error ", error);
				return callback(error);
			}

			if (!result || !result.length) {
				logger.debug("CDS: browseItem repository mountPath="
						+ repository.mountPath + " => No result list="
						+ list.length);

				return callback(null, list);
			}

			logger.debug("CDS: browseItem repository mountPath="
					+ repository.mountPath + " => " + result.length,
					" list=" + list.length);

			logger.debug("Browse => " + result);

			callback(null, list.concat(result));
		});

	}, function (error, list) {
		if (error) {
			logger.error("CDS: browseItem '" + path + "' returns error ",
					error);
			return callback(error);
		}

		logger.debug("CDS: browseItem '" + path + "' returns " + list.length + " elements.");

		return callback(null, list);
	});
};

ContentDirectoryService.prototype.newItem = function (parent, name, upnpClass,
		container, callback) {
	var item = new Item(parent, name, upnpClass, container);

	this.upnpServer.registerItem(item, function (error) {
		if (error) {
			logger.error("Register item error=", error);
			return callback(error);
		}

		return callback(null, item, item.id);
	});
};

ContentDirectoryService.prototype.newContainer = function (parent, name,
		upnpClass, callback) {

	return this.newItem(parent, name, upnpClass || Item.CONTAINER, true,
			callback);
};

ContentDirectoryService.prototype.newFolder = function (parent, path, stats,
		upnpClass, callback) {
	var name = Path.basename(path);

	return this.newContainer(parent, name, upnpClass,
		function (error, item, id) {
			if (error) {
				return callback(error);
			}

			item.realpath = path;

			if (stats) {
				item.setDate(stats.mtime);

				return callback(null, item, id);
			}

			fs.stat(path, function (error, stats) {
				if (error) {
					return callback(error);
				}

				item.setDate(stats.mtime);

				return callback(null, item, id);
			});
		});
};

ContentDirectoryService.prototype.computeTitle = function (item, path, mimeType, callback) {
	var title = item.name;
	var idx = title.lastIndexOf('.');
	if (idx > 0) {
		title = title.substring(0, idx);
	}

	// TODO customize title by filters
	idx = title.indexOf("__");
	if (idx > 0) {
		title = title.substring(0, idx);
	}

	callback(null, title);
};

ContentDirectoryService.prototype.newFile = function (parent, path, upnpClass,
		stats, callback) {
	var mimeType = (stats && stats.mimeType)
			|| Mime.lookup(Path.extname(path).substring(1),
					"application/octet-stream");

	var name = Path.basename(path);

	var self = this;
	this.newItem(parent, name, upnpClass, false, function (error, item, id) {
		if (error) {
			return callback(error);
		}

		item.realpath = path;

		self.computeTitle(item, path, mimeType, function (error, title) {
			if (error) {
				return callback(error);
			}

			if (!title) {
				title = name;
			}

			item.title = title;

			item.resAttrs = {
				protocolInfo : "http-get:*:" + mimeType + ":*"
			};

			if (stats) {
				item.resAttrs.size = stats.size;
				item.setDate(stats.mtime);

				return callback(null, item, id);
			}

			fs.stat(path, function (error, stats) {
				if (error) {
					return callback(error);
				}

				item.resAttrs.size = stats.size;
				item.setDate(stats.mtime);

				return callback(null, item, id);
			});
		});
	});
};

ContentDirectoryService.prototype.newPhoto = function (parent, path, stats,
		callback) {
	return this.newFile(parent, path, Item.PHOTO_FILE, stats, callback);
};

ContentDirectoryService.prototype.newVideo = function (parent, path, stats,
		callback) {
	return this.newFile(parent, path, Item.VIDEO_FILE, stats, callback);
};

ContentDirectoryService.prototype.newAudio = function (parent, path, stats,
		callback) {
	return this.newFile(parent, path, Item.AUDIO_FILE, stats, callback);
};

ContentDirectoryService.prototype.updateItem = function (item, callback) {
	// Il faut identifier le repository associé à cet item

	var path = item.getItemPath();

	logger.debug("CDS: updateItem itemID=" + item.itemId + " path='" + path
			+ "' repositories.count=" + this.repositories.length);

	Async.each(this.repositories, function (repository, callback) {

		if (path.indexOf(repository.mountPath) !== 0) {
			logger.debug("CDS: browseItem repository mountPath="
					+ repository.mountPath + " path is not in mountpath");
			return callback(null);
		}

		logger.debug("CDS: updateItem repository mountPath="
				+ repository.mountPath);

		repository.update(item, function (error, result) {
			if (error) {
				logger.error("CDS: updateItem repository mountPath="
						+ repository.mountPath + " error ", error);
				return callback(error);
			}

			callback(null);
		});

	}, function (error) {
		if (error) {
			logger.error("CDS: updateItem '" + path + "' returns error ",
					error);
			return callback(error);
		}

		logger.debug("CDS: updateItem '" + path + "'.");
		
		return callback(null);
	});
};
