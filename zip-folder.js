var fs = require('fs');
var archiver = require('archiver');

function zipFolder(srcFolder, zipFilePath, callback) {
	var output = fs.createWriteStream(zipFilePath);
	var zipArchive = archiver('zip', {
		store: true // Sets the compression method to STORE. 
	});

	output.on('close', function() {
		callback();
	});

	zipArchive.pipe(output);

	zipArchive.glob("**/*", {cwd: srcFolder});

	zipArchive.finalize(function(err, bytes) {
		if (err) {
			callback(err);
		}
	});
}

module.exports = zipFolder;
