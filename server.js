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
    service: 'ffmpeg-api', 
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// YouTube download endpoint
app.post('/', async (req, res) => {
  let jobId;
  let outputPath;
  
  try {
    const {
      url,
      format = 'best[height<=720]',
      quality = '720p',
      maxDuration = 60,
      title,
      channel
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
    outputPath = `/tmp/${jobId}_%(title)s.%(ext)s`;

    try {
      console.log(`[${jobId}] Starting YouTube download...`);

      // Build yt-dlp command
      const command = `yt-dlp -f "${format}" --max-filesize 100M --no-check-certificate "${url}" -o "${outputPath}"`;

      console.log(`[${jobId}] Executing: ${command}`);
      
      const { stdout, stderr } = await execPromise(command);
      
      console.log(`[${jobId}] Download stdout: ${stdout}`);
      if (stderr) console.log(`[${jobId}] Download stderr: ${stderr}`);

      // Find the actual downloaded file
      const files = fs.readdirSync('/tmp').filter(file => file.includes(jobId));
      if (files.length === 0) {
        throw new Error('No downloaded file found');
      }

      const actualFilePath = path.join('/tmp', files[0]);
      const stats = fs.statSync(actualFilePath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      console.log(`[${jobId}] Download completed: ${fileSizeMB}MB`);

      // Return success response
      res.json({
        success: true,
        jobId: jobId,
        downloadedFile: actualFilePath,
        fileSizeMB: parseFloat(fileSizeMB),
        title: title,
        channel: channel,
        originalUrl: url,
        message: 'Video downloaded successfully'
      });

      // Cleanup after 5 minutes
      setTimeout(() => {
        if (fs.existsSync(actualFilePath)) {
          fs.unlinkSync(actualFilePath);
          console.log(`[${jobId}] Cleaned up temporary file`);
        }
      }, 300000);

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

// Simple test endpoint
app.post('/test', (req, res) => {
  res.json({
    success: true,
    message: 'API is working',
    received: req.body
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`FFmpeg API server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`YouTube download endpoint: POST http://localhost:${PORT}/`);
});
