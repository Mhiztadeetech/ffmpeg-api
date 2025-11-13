const express = require('express');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const execPromise = util.promisify(exec);

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

// Test yt-dlp availability
app.get('/test-ytdlp', async (req, res) => {
  try {
    const { stdout, stderr } = await execPromise('which yt-dlp || echo "yt-dlp not found"');
    res.json({
      ytdlpAvailable: stdout.includes('yt-dlp'),
      path: stdout.trim(),
      stderr: stderr
    });
  } catch (error) {
    res.json({
      ytdlpAvailable: false,
      error: error.message
    });
  }
});

// YouTube download endpoint
app.post('/', async (req, res) => {
  let jobId;
  
  try {
    const {
      url,
      format = 'best[height<=720]',
      quality = '720p'
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
    const outputPath = `./tmp/${jobId}`;

    // Ensure tmp directory exists
    if (!fs.existsSync('./tmp')) {
      fs.mkdirSync('./tmp');
    }

    try {
      console.log(`[${jobId}] Starting YouTube download...`);

      // Build yt-dlp command - try different approaches
      const commands = [
        `yt-dlp -f "${format}" --max-filesize 100M "${url}" -o "${outputPath}.%(ext)s"`,
        `python3 -m yt_dlp -f "${format}" --max-filesize 100M "${url}" -o "${outputPath}.%(ext)s"`
      ];

      let lastError;
      
      for (const command of commands) {
        try {
          console.log(`[${jobId}] Trying: ${command}`);
          const { stdout, stderr } = await execPromise(command);
          console.log(`[${jobId}] Success with command`);
          break;
        } catch (error) {
          lastError = error;
          console.log(`[${jobId}] Command failed: ${error.message}`);
          continue;
        }
      }

      if (lastError && !fs.existsSync(`${outputPath}.mp4`) && !fs.existsSync(`${outputPath}.mkv`)) {
        throw lastError;
      }

      // Find the actual downloaded file
      const downloadedFile = fs.existsSync(`${outputPath}.mp4`) ? 
        `${outputPath}.mp4` : 
        `${outputPath}.mkv`;

      if (!fs.existsSync(downloadedFile)) {
        throw new Error('Downloaded file not found');
      }

      const stats = fs.statSync(downloadedFile);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      console.log(`[${jobId}] Download completed: ${fileSizeMB}MB`);

      // For Railway, we can't serve files directly, so return success
      res.json({
        success: true,
        jobId: jobId,
        fileSizeMB: parseFloat(fileSizeMB),
        fileName: path.basename(downloadedFile),
        message: 'Video downloaded successfully (stored temporarily)'
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
});
