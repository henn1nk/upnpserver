/*jslint node: true, plusplus: true, nomen: true, vars: true */
"use strict";

var ScannerRepository = require('./scannerRepository');
var Util = require('util');
var async = require('async');
var fs = require('fs');
var Path = require('path');
var Mime = require('mime');
var Item = require('./item');
var ID3 = require("id3");
var Async = require("async");
var Buffer = require("buffer").Buffer;
var logger = require('./logger');

var ARTISTS_REPOSITORY = "Artistes";

var MusicRepository = function (mountPath, path, searchClasses) {
	ScannerRepository.call(this, mountPath, path);
};

Util.inherits(MusicRepository, ScannerRepository);

module.exports = MusicRepository;

ScannerRepository.prototype.keepFile = function (infos) {
	var mime = Mime.lookup(Path.basename(infos.path));
	var mime0 = mime.split("/")[0];

	if (mime0 !== "audio") {
		return false;
	}

	infos.mime = mime;

	return true;
};

MusicRepository.prototype.processFile = function (rootItem, infos, callback) {

	// logger.debug("Process file", infos.path);

	var buffer = new Buffer(16000);
	var self = this;
	fs.open(infos.path, "r", function (error, fd) {
		fs.read(fd, buffer, 0, buffer.length, 0, function (error, data) {
			fs.close(fd, function (error2) {

				if (error || error2) {
					logger.error("Can not read path=", infos.path, " error=",
							error || error2);
					return callback(null);
				}

				var tags = new ID3(buffer);
				tags.parse();

				// logger.debug("Read file", infos.path);

				self._construct(rootItem, infos.path, tags, callback);
			});
		});
	});
};

MusicRepository.prototype._construct = function (rootItem, path, tags, callback) {
	if (!tags) {
		logger.error("No id3 tags for path=", path);
		return callback(null);
	}
	// logger.debug("Tags=",tags.getTags());

	var album = tags.get("album") || "Album unknown";
	var title = tags.get("title") || "Title unknown";
	var artist = tags.get("artist") || "Artist unknown";
	var genre = tags.get("genre") || "Genre unknown";

	var tasks = [];

	if (artist) {
		tasks.push({
			fn : this._registerArtistFolder,
			param : artist
		});
	}

	if (genre) {
		tasks.push({
			fn : this._registerGenreFolder,
			param : genre
		});
	}

	var self = this;
	Async.each(tasks, function (task, callback) {
		// logger.debug("Task: ", task.fn, task.param);

		task.fn.call(self, rootItem, path, task.param, album, title, tags,
				callback);

	}, function (error) {
		if (error) {
			return callback(error);
		}

		callback();
	});
};

MusicRepository.prototype._registerArtistFolder = function (rootItem, path,
		artist, album, title, tags, callback) {

	logger.debug("Register artist folder on " + rootItem.itemId + " path="
			+ path + " artist=" + artist + " album=" + album);

	var self = this;
	rootItem.getChildByName(ARTISTS_REPOSITORY, function (error, item) {
		if (error) {
			return callback(error);
		}

		if (!item) {
			return self.contentDirectoryService.newContainer(
				rootItem,
				ARTISTS_REPOSITORY,
				Item.CONTAINER,
				function (error, item) {
					if (error) {
						return callback(error);
					}

					item.virtual = true;

					self._registerArtist(item, path, artist, album, title,
							tags, callback);
				}
			);
		}

		self._registerArtist(item, path, artist, album, title, tags, callback);
	});
};

MusicRepository.prototype._registerArtist = function (rootItem, path, artist,
		album, title, tags, callback) {

	logger.debug("Register artist on " + rootItem.itemId + " path=" + path
			+ " artist=" + artist + " album=" + album);

	var self = this;
	rootItem.getChildByName(artist, function (error, item) {
		if (error) {
			return callback(error);
		}

		if (!item) {
			return self.contentDirectoryService.newContainer(
				rootItem,
				artist,
				Item.MUSIC_ARTIST,
				function (error, item) {
					if (error) {
						return callback(error);
					}

					item.virtual = true;

					self._registerAlbum(item, path, album, title, tags, callback);
				}
			);
		}

		self._registerAlbum(item, path, album, title, tags, callback);
	});
};

MusicRepository.prototype._registerAlbum = function (rootItem, path, album,
		title, tags, callback) {

	logger.debug("Register album on " + rootItem.itemId + " path=" + path
			+ " album=" + album + " title=" + title);

	var self = this;
	rootItem.getChildByName(album, function (error, item) {
		if (error) {
			return callback(error);
		}

		if (!item) {
			return self.contentDirectoryService.newContainer(
				rootItem,
				album,
				Item.MUSIC_ALBUM,
				function (error, item) {
					if (error) {
						return callback(error);
					}

					item.virtual = true;

					self._registerTitle(item, path, title, tags, 0, callback);
				}
			);
		}

		self._registerTitle(item, path, title, tags, 0, callback);
	});
};

MusicRepository.prototype._registerTitle = function (rootItem, path, title,
		tags, tryCount, callback) {

	var t = title;
	if (tryCount) {
		t = title + "  (#" + (tryCount) + ")";
	}

	logger.debug("Register title on " + rootItem.itemId + " path=" + path
			+ " title=" + title + " count=" + tryCount);

	var self = this;
	rootItem.getChildByName(t, function (error, item) {
		if (error) {
			return callback(error);
		}

		if (!item) {
			return self.contentDirectoryService.newFile(
				rootItem,
				path,
				Item.MUSIC_TRACK,
				null,
				function (error, item) {
					if (error) {
						return callback(error);
					}

					item.title = t;
					item.id3tags = tags;

					callback(null, item);
				}
			);
		}

		return self._registerTitle(rootItem, path, title, tags, tryCount + 1,
				callback);
	});
};

MusicRepository.prototype._registerGenreFolder = function (rootItem, path,
		genre, album, title, tags, callback) {

	return this._registerGenre(rootItem, path, genre, album, title, tags,
			callback);
};

MusicRepository.prototype._registerGenre = function (rootItem, path, genre,
		album, title, tags, callback) {

	var self = this;
	rootItem.getChildByName(genre, function (error, item) {
		if (error) {
			return callback(error);
		}

		if (!item) {
			return self.contentDirectoryService.newContainer(
				rootItem,
				genre,
				Item.MUSIC_GENRE,
				function (error, item) {
					if (error) {
						return callback(error);
					}

					item.virtual = true;

					self._registerAlbum(item, path, album, title, tags, callback);
				}
			);
		}

		self._registerAlbum(item, path, album, title, tags, callback);
	});
};
