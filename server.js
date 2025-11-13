const express = require('express');
const youtubedl = require('youtube-dl-exec');
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
    service: 'yt-dlp-api', 
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// YouTube download endpoint
app.post('/', async (req, res) => {
  let jobId;
  
  try {
    const {
      url,
      format = 'best[height<=720]',
      quality = '720p',
      maxDuration = 60
    } = req.body;

    console.log('Download request received:', { url, format, quality });

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'YouTube URL is required'
      });
    }

    // Generate unique job ID
    jobId = uuidv4();
    const outputPath = `./tmp/${jobId}.%(ext)s`;

    // Ensure tmp directory exists
    if (!fs.existsSync('./tmp')) {
      fs.mkdirSync('./tmp');
    }

    try {
      console.log(`[${jobId}] Starting YouTube download...`);

      // Download using youtube-dl-exec (Node.js native)
      const result = await youtubedl(url, {
        format: format,
        output: outputPath,
        maxFilesize: '100M',
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        addHeader: [
          '--referer', 'https://www.youtube.com/',
          '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        ]
      });

      console.log(`[${jobId}] Download result:`, result);

      // Find the actual downloaded file
      const files = fs.readdirSync('./tmp').filter(file => file.includes(jobId));
      if (files.length === 0) {
        throw new Error('No downloaded file found');
      }

      const downloadedFile = path.join('./tmp', files[0]);
      const stats = fs.statSync(downloadedFile);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      console.log(`[${jobId}] Download completed: ${fileSizeMB}MB`);

      // Return success response
      res.json({
        success: true,
        jobId: jobId,
        fileSizeMB: parseFloat(fileSizeMB),
        fileName: files[0],
        message: 'Video downloaded successfully',
        videoInfo: {
          url: url,
          quality: quality,
          format: format
        }
      });

      // Cleanup after 2 minutes
      setTimeout(() => {
        if (fs.existsSync(downloadedFile)) {
          fs.unlinkSync(downloadedFile);
          console.log(`[${jobId}] Cleaned up temporary file`);
        }
      }, 120000);

    } catch (downloadError) {
      console.error(`[${jobId}] Download error:`, downloadError);
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

// Test endpoint to check if YouTube download works
app.post('/test-download', async (req, res) => {
  try {
    const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // Famous "Me at the zoo" video
    
    const result = await youtubedl(testUrl, {
      dumpJson: true,
      noCheckCertificates: true,
      noWarnings: true,
    });

    res.json({
      success: true,
      message: 'YouTube download test successful',
      videoTitle: result.title,
      duration: result.duration,
      formats: result.formats ? result.formats.length : 0
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'YouTube download test failed'
    });
  }
});

// Simple echo endpoint for testing
app.post('/echo', (req, res) => {
  res.json({
    success: true,
    message: 'Request received',
    body: req.body,
    headers: req.headers
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`YouTube Download API running on port ${PORT}`);
  console.log(`Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`Test download: POST http://0.0.0.0:${PORT}/test-download`);
});
