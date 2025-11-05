const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads
const upload = multer({ dest: '/tmp/uploads/' });

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'ffmpeg-api', version: '1.0.0' });
});

// Main video processing endpoint
app.post('/process-video', upload.single('video'), async (req, res) => {
  try {
    const {
      videoUrl,
      startTime = 0,
      endTime,
      outputFormat = 'mp4',
      quality = '720p',
      addIntro = false,
      addOutro = false,
      filters = []
    } = req.body;

    // Generate unique job ID
    const jobId = uuidv4();
    const inputPath = req.file ? req.file.path : `/tmp/${jobId}_input.mp4`;
    const outputPath = `/tmp/${jobId}_output.${outputFormat}`;

    console.log(`[${jobId}] Starting video processing...`);

    // Download video if URL provided
    if (videoUrl && !req.file) {
      console.log(`[${jobId}] Downloading video from: ${videoUrl}`);
      const response = await axios({
        method: 'GET',
        url: videoUrl,
        responseType: 'stream'
      });
      
      const writer = fs.createWriteStream(inputPath);
      response.data.pipe(writer);
      
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      
      console.log(`[${jobId}] Download complete`);
    }

    // Validate input file exists
    if (!fs.existsSync(inputPath)) {
      throw new Error('Input video file not found');
    }

    // Build FFmpeg command
    let command = ffmpeg(inputPath);

    // Set start and end time (trim video)
    if (startTime) {
      command = command.setStartTime(startTime);
    }
    if (endTime) {
      command = command.setDuration(endTime - startTime);
    }

    // Apply quality settings
    const qualitySettings = {
      '360p': { width: 640, height: 360, bitrate: '800k' },
      '480p': { width: 854, height: 480, bitrate: '1200k' },
      '720p': { width: 1280, height: 720, bitrate: '2500k' },
      '1080p': { width: 1920, height: 1080, bitrate: '5000k' }
    };

    const settings = qualitySettings[quality] || qualitySettings['720p'];
    command = command
      .size(`${settings.width}x${settings.height}`)
      .videoBitrate(settings.bitrate)
      .audioCodec('aac')
      .audioBitrate('128k');

    // Apply custom filters
    if (filters && filters.length > 0) {
      command = command.videoFilters(filters);
    }

    // Add fade in/out effects
    const videoFilters = [];
    if (addIntro) {
      videoFilters.push('fade=in:0:30'); // Fade in for 1 second (30 frames at 30fps)
    }
    if (addOutro) {
      videoFilters.push('fade=out:st=' + (endTime - startTime - 1) + ':d=1');
    }
    if (videoFilters.length > 0) {
      command = command.videoFilters(videoFilters);
    }

    // Set output format
    command = command.format(outputFormat);

    // Process video
    console.log(`[${jobId}] Processing video...`);
    
    await new Promise((resolve, reject) => {
      command
        .on('start', (commandLine) => {
          console.log(`[${jobId}] FFmpeg command: ${commandLine}`);
        })
        .on('progress', (progress) => {
          console.log(`[${jobId}] Processing: ${progress.percent}% done`);
        })
        .on('end', () => {
          console.log(`[${jobId}] Processing complete`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`[${jobId}] Error: ${err.message}`);
          reject(err);
        })
        .save(outputPath);
    });

    // Get output file stats
    const stats = fs.statSync(outputPath);
    const fileSize = stats.size;
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);

    // Read output file as base64 (for small files) or return download URL
    let outputData;
    if (fileSize < 10 * 1024 * 1024) { // Less than 10MB
      const fileBuffer = fs.readFileSync(outputPath);
      outputData = fileBuffer.toString('base64');
    } else {
      // For larger files, you'd upload to cloud storage and return URL
      outputData = null;
    }

    // Cleanup input file
    if (fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath);
    }

    // Return response
    res.json({
      success: true,
      jobId: jobId,
      outputPath: outputPath,
      fileSize: fileSize,
      fileSizeMB: parseFloat(fileSizeMB),
      duration: endTime - startTime,
      resolution: `${settings.width}x${settings.height}`,
      format: outputFormat,
      outputData: outputData, // Base64 encoded video (if small enough)
      message: 'Video processed successfully'
    });

    // Cleanup output file after response (optional - keep for debugging)
    setTimeout(() => {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
    }, 60000); // Delete after 1 minute

  } catch (error) {
    console.error('Error processing video:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`FFmpeg API server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});