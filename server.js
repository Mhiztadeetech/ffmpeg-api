const express = require('express');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'youtube-download-api', 
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

// YouTube download endpoint
app.post('/', async (req, res) => {
  let jobId;
  let outputStream;
  
  try {
    const {
      url,
      quality = 'highest',
      maxDuration = 60
    } = req.body;

    console.log('Download request received:', { url, quality });

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'YouTube URL is required'
      });
    }

    // Validate YouTube URL
    if (!ytdl.validateURL(url)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL'
      });
    }

    // Generate unique job ID
    jobId = uuidv4();
    const outputPath = `./tmp/${jobId}.mp4`;

    // Ensure tmp directory exists
    if (!fs.existsSync('./tmp')) {
      fs.mkdirSync('./tmp');
    }

    try {
      console.log(`[${jobId}] Starting YouTube download...`);

      // Get video info first
      const info = await ytdl.getInfo(url);
      const videoTitle = info.videoDetails.title;
      const duration = parseInt(info.videoDetails.lengthSeconds);

      // Check duration limit
      if (maxDuration && duration > maxDuration) {
        return res.status(400).json({
          success: false,
          error: `Video too long: ${duration}s > ${maxDuration}s limit`,
          duration: duration,
          maxDuration: maxDuration
        });
      }

      // Set up download options
      const downloadOptions = {
        quality: quality === '720p' ? 'highest' : quality,
        filter: format => format.container === 'mp4',
      };

      // Create write stream
      outputStream = fs.createWriteStream(outputPath);
      
      // Download video
      const downloadPromise = new Promise((resolve, reject) => {
        const videoStream = ytdl(url, downloadOptions)
          .on('progress', (chunkLength, downloaded, total) => {
            const percent = (downloaded / total * 100).toFixed(2);
            console.log(`[${jobId}] Download progress: ${percent}%`);
          })
          .on('error', (error) => {
            reject(error);
          })
          .on('end', () => {
            console.log(`[${jobId}] Download completed`);
            resolve();
          });

        videoStream.pipe(outputStream);
      });

      await downloadPromise;

      // Get file stats
      const stats = fs.statSync(outputPath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      console.log(`[${jobId}] Download completed: ${fileSizeMB}MB`);

      // Return success response
      res.json({
        success: true,
        jobId: jobId,
        fileSizeMB: parseFloat(fileSizeMB),
        fileName: `${jobId}.mp4`,
        videoInfo: {
          title: videoTitle,
          duration: duration,
          url: url,
          quality: quality
        },
        message: 'Video downloaded successfully'
      });

      // Cleanup after 2 minutes
      setTimeout(() => {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
          console.log(`[${jobId}] Cleaned up temporary file`);
        }
      }, 120000);

    } catch (downloadError) {
      console.error(`[${jobId}] Download error:`, downloadError);
      
      // Clean up failed download
      if (outputStream) {
        outputStream.destroy();
      }
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      
      throw new Error(`YouTube download failed: ${downloadError.message}`);
    }

  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      jobId: jobId || 'unknown',
      details: 'Failed to download video from YouTube'
    });
  }
});

// Get video info endpoint (without downloading)
app.post('/info', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'YouTube URL is required'
      });
    }

    if (!ytdl.validateURL(url)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL'
      });
    }

    const info = await ytdl.getInfo(url);
    
    res.json({
      success: true,
      videoInfo: {
        title: info.videoDetails.title,
        duration: parseInt(info.videoDetails.lengthSeconds),
        author: info.videoDetails.author.name,
        viewCount: info.videoDetails.viewCount,
        thumbnails: info.videoDetails.thumbnails,
        formats: info.formats.map(f => ({
          quality: f.qualityLabel,
          container: f.container,
          hasVideo: f.hasVideo,
          hasAudio: f.hasAudio
        }))
      }
    });

  } catch (error) {
    console.error('Error getting video info:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Failed to get video information'
    });
  }
});

// Test endpoint
app.post('/test', async (req, res) => {
  try {
    const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // Short test video
    
    if (!ytdl.validateURL(testUrl)) {
      return res.status(400).json({
        success: false,
        error: 'Test URL is invalid'
      });
    }

    const info = await ytdl.getInfo(testUrl);
    
    res.json({
      success: true,
      message: 'YouTube API test successful',
      videoTitle: info.videoDetails.title,
      duration: `${info.videoDetails.lengthSeconds}s`,
      canDownload: true
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'YouTube API test failed'
    });
  }
});

// Simple echo endpoint
app.post('/echo', (req, res) => {
  res.json({
    success: true,
    message: 'Request received',
    body: req.body
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`YouTube Download API running on port ${PORT}`);
  console.log(`Health check: GET http://0.0.0.0:${PORT}/health`);
  console.log(`Test endpoint: POST http://0.0.0.0:${PORT}/test`);
});
