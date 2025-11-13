const express = require('express');
const ytdl = require('yt-dlp-exec');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
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
  res.json({ status: 'healthy', service: 'ffmpeg-api', version: '1.0.0' });
});

// YouTube download endpoint (matches what n8n expects)
app.post('/', async (req, res) => {
  try {
    const {
      url,
      format = 'bestvideo[height<=720]+bestaudio/best[height<=720]',
      quality = '720p',
      maxDuration = 60,
      title,
      channel
    } = req.body;

    console.log('Download request received:', { url, format, quality, maxDuration });

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'YouTube URL is required'
      });
    }

    // Generate unique job ID
    const jobId = uuidv4();
    const outputPath = `/tmp/${jobId}_output.mp4`;

    try {
      // Download video using yt-dlp
      console.log(`[${jobId}] Starting YouTube download...`);
      
      await ytdl(url, {
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

      // Check if file was created
      if (!fs.existsSync(outputPath)) {
        throw new Error('Downloaded file not found');
      }

      const stats = fs.statSync(outputPath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      console.log(`[${jobId}] Download completed: ${fileSizeMB}MB`);

      // Return success response (n8n format)
      res.json({
        success: true,
        jobId: jobId,
        downloadedFile: outputPath,
        fileSizeMB: parseFloat(fileSizeMB),
        title: title,
        channel: channel,
        originalUrl: url,
        message: 'Video downloaded successfully'
      });

      // Cleanup after 5 minutes
      setTimeout(() => {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
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
      details: 'Failed to download video from YouTube'
    });
  }
});

// Your existing process-video endpoint (keep for other processing)
app.post('/process-video', async (req, res) => {
  // ... keep your existing process-video code here
});

// Start server
app.listen(PORT, () => {
  console.log(`FFmpeg API server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`YouTube download endpoint: POST http://localhost:${PORT}/`);
});
