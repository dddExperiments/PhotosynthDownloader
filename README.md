### PhotosynthDownloader
Unofficial photosynth ps1/ps2 downloader.

### Setup:
install node.js
Then in the folder where you have checkout this repo, run the following command line:
```
npm install
```

### Example usage:
```
node synth_downloader.js 9dc5a790-1a11-4ef3-9d76-194ca1fb2f6e output
```
this will create 9dc5a790-1a11-4ef3-9d76-194ca1fb2f6e.zip in output folder (output need to exist).

### Note:
I recommend to use a ram disk as it will create a lot of temporary files ~50k for each synth that you download.
I'm using ImDisk: http://www.ltr-data.se/opencode.html/.

### Know issues:
- Synth downloaded with this package won't work directly with the official offlineViewer released by Microsoft.
  I've updated the offlineViewer to support both official and unofficial ps2 zip file.
  The behind the scene issue is that official zip are using '\\' as path separator instead of '/'.
  I've updated the viewer to support both '\\' and '/' zip path separator.
- Synth downloading can fail with ETIMEDOUT error -> just retry downloading: it will resume exactly were it stopped.
- Panorama are downloaded as zip file but can't be viewed directly by any offline viewer.

### Mass downloader:
I've added a mass downloader to process several synths at once.
See doc in `mass_synth_downloader.js` (for expert user).

Please use responsively.

--Henri
