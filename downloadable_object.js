var fs          = require('fs');
var http        = require('http');
var https       = require('https');
var parseString = require('xml2js').parseString;
var request       = require('request');

// Class for managing objects that need to be downloaded/parsed in memory/saved to disk.
// This class support resuming jobs with the following features:
// - DownloadToFile will be skipped if target file exists.
// - DownloadToMemory will actually read from disk if file exists.
// - SaveToDisk will be skipped if file exists and will first save to filepath.tmp and then rename to filepath.

function DownloadableObject() {
	
	// Construct object.
	this.Init = function(filepath, url) {
		this.filepath = filepath;
		this.url = url;
	};
	
	// Check that we can write the target file.
	this.TargetFileExists = function(onComplete) {
		fs.access(_that.filepath, fs.constants.W_OK, function(err) {
			var file_exist = !err;
			onComplete(file_exist);
		});
	};
	
	// Read target file from disk as buffer.
	this.ReadTargetFile = function(onComplete, onError) {
		fs.readFile(_that.filepath, function (err, data) {
			if (err) {
				if (onError) { onError(_that); }
			}
			else {
				_that.file_content = data;
				onComplete(_that);
			}
		});
	};
	
	// Download to file (by keeping file fully in memory).
	// TODO: pipe directly to disk if file is too big (> 50MB).
	this.DownloadToFile = function(onComplete, onError) {
		_that.DownloadToMemory(function() {
			_that.SaveToDisk(onComplete, onError);
		}, onError);
	};
	
	// Download to file but do not save 404 file.
	this.SilentDownloadToFile = function(onComplete, onError) {
		_that.DownloadToMemory(function() {
			_that.SaveToDisk(onComplete, onError);
		}, onComplete);		
	};

	this.DownloadToMemory = function(onComplete, onError) {
		// If filepath is provided, check if file was already saved.
		if (_that.filepath) {			
			_that.TargetFileExists(function(exists) {
				if (exists) {
					// If file exists, just read it.
					_that.ReadTargetFile(onComplete, onError);
				} else {
					// If it doesn't, download it.
					_that.DownloadBuffer(onComplete, onError);
				}
			});
		} else {
			console.log("Caching is disabled for \"" + _that.url + "\" as not filepath as been provided prior to DownloadToMemory.");
			_that.DownloadBuffer(onComplete, onError);
		}
	};
	
	this.DownloadBuffer = function(onComplete, onError) {
		var downloader = _that.url.indexOf("https://") == -1 ? http : https;
		var chunks = [];
		downloader.get(_that.url, function(res) {
			if (res.statusCode == 404) {
				onError(_that);
				return;
			}
			res.on('data', function(chunk) {
				chunks.push(chunk)
			});
			res.on('error', function() {
				if (onError) { onError(_that); }
			});
			res.on('end', function() {
				_that.file_content = Buffer.concat(chunks);
				onComplete(_that);
			});
		});
	};
	
	this.PostSoapRequest = function(guid, onComplete, onError) {
		_that.url = "https://photosynth.net/photosynthws/photosynthservice.asmx";
		var request_body = '';
		request_body += '<?xml version="1.0" encoding="utf-8"?>';
		request_body += '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">';
		request_body += '  <soap:Body>';
		request_body += '    <GetCollectionData xmlns="http://labs.live.com/">';
		request_body += '      <collectionId>'+guid+'</collectionId>';
		request_body += '      <incrementEmbedCount>false</incrementEmbedCount>';
		request_body += '    </GetCollectionData>';
		request_body += '  </soap:Body>';
		request_body += '</soap:Envelope>';
		
		request({
			url: _that.url,
			method: "POST",
			headers: {
				"content-type": "text/xml; charset=utf8",
			},
			body: request_body
		}, function (error, response, body){
			if (error) {
				onError(error);
			} else {
				_that.file_content = body;
				onComplete(body);
			}
		});		
	};

	// Save content previously downloaded to disk.
	this.SaveToDisk = function(onComplete, onError) {
		// Skip saving if file already exists.
		_that.TargetFileExists(function(exists) {
			if (exists) {
				onComplete(_that);
			} else {
				// Write to filepath.tmp file.
				fs.writeFile(_that.filepath + ".tmp",  _that.file_content, function (err) {
					if (err) {
						if (onError) { onError(_that); }
					}
					else {
						// Rename filepath.tmp to filepath.
						fs.rename(_that.filepath + ".tmp", _that.filepath, function(err) {
							if (err) {
								if (onError) { onError(_that); }
							} else {
								onComplete();
							}
						});
					}
				});
			}
		});
	};
	
	this.ParseJson = function() {
		return JSON.parse(_that.file_content);
	};
	
	this.ParseXml = function(onComplete, onError) {
		parseString(_that.file_content, function (err, result) {
			if (err) {
				if (onError) {  onError(_that); }
			} else {
				onComplete(result);
			}
		});
	};
	
	this.Clear = function() {
		this.filepath = "";
		this.url = "";
		this.file_content = "";
	};
	
	var _that = this;
	this.filepath;
	this.url;
	this.file_content;	
};

var exports = module.exports = {};

exports.DownloadableObject = DownloadableObject;