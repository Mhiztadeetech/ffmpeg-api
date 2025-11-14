const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  next();
});

// Rate limiting and block mitigation
const downloadAttempts = new Map();
const MAX_ATTEMPTS = 5;
const TIME_WINDOW = 60000;

class YouTubeDownloadManager {
  constructor() {
    this.currentProxyIndex = 0;
  }

  getNextProxy() {
    const proxies = [
      process.env.PROXY_1,
      process.env.PROXY_2,
      process.env.PROXY_3
    ].filter(Boolean);
    
    if (proxies.length === 0) return null;
    this.currentProxyIndex = (this.currentProxyIndex + 1) % proxies.length;
    return proxies[this.currentProxyIndex];
  }

  async getVideoInfo(videoUrl) {
    try {
      console.log(`Getting video info for: ${videoUrl}`);
      
      const options = {
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        }
      };

      const proxy = this.getNextProxy();
      if (proxy) {
        options.requestOptions.proxy = proxy;
        console.log(`Using proxy: ${proxy}`);
      }

      const info = await ytdl.getInfo(videoUrl, options);
      console.log(`Successfully got info for: ${info.videoDetails.title}`);
      return info;
    } catch (error) {
      console.error('Error getting video info:', error.message);
      throw new Error(`Failed to get video info: ${error.message}`);
    }
  }

  async downloadVideo(videoUrl, format = 'mp4', quality = 'highest') {
    console.log(`Starting download: ${videoUrl}, format: ${format}, quality: ${quality}`);
    
    const videoId = ytdl.getVideoID(videoUrl);
    
    if (this.isRateLimited(videoId)) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    try {
      const info = await this.getVideoInfo(videoUrl);
      const outputPath = path.join('/tmp', `${uuidv4()}.${format}`);
      
      console.log(`Output path: ${outputPath}`);

      const options = {
        quality: quality,
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'identity'
          }
        }
      };

      const proxy = this.getNextProxy();
      if (proxy) {
        options.requestOptions.proxy = proxy;
      }

      if (format === 'mp3' || format === 'audio') {
        options.filter = 'audioonly';
      } else {
        options.filter = 'videoandaudio';
      }

      return new Promise((resolve, reject) => {
        const videoStream = ytdl(videoUrl, options);

        videoStream.on('info', (info) => {
          console.log('Download started for:', info.videoDetails.title);
        });

        videoStream.on('progress', (chunkLength, downloaded, total) => {
          const percent = (downloaded / total * 100).toFixed(2);
          console.log(`Download progress: ${percent}%`);
        });

        if (format === 'mp3') {
          ffmpeg(videoStream)
            .audioBitrate(128)
            .toFormat('mp3')
            .on('error', (err) => {
              console.error('FFmpeg error:', err);
              reject(err);
            })
            .on('end', () => {
              console.log('MP3 conversion completed');
              resolve(outputPath);
            })
            .save(outputPath);
        } else {
          const writeStream = fs.createWriteStream(outputPath);
          
          videoStream.pipe(writeStream);
          
          writeStream.on('finish', () => {
            console.log('Download completed');
            resolve(outputPath);
          });
          writeStream.on('error', reject);
        }

        videoStream.on('error', (error) => {
          console.error('YouTube download stream error:', error);
          reject(error);
        });
      });

    } catch (error) {
      this.recordAttempt(videoId);
      console.error('Download error:', error);
      throw error;
    }
  }

  isRateLimited(videoId) {
    const now = Date.now();
    const attempts = downloadAttempts.get(videoId) || [];
    const recentAttempts = attempts.filter(time => now - time < TIME_WINDOW);
    downloadAttempts.set(videoId, recentAttempts);
    return recentAttempts.length >= MAX_ATTEMPTS;
  }

  recordAttempt(videoId) {
    const attempts = downloadAttempts.get(videoId) || [];
    attempts.push(Date.now());
    downloadAttempts.set(videoId, attempts);
  }
}

const downloadManager = new YouTubeDownloadManager();

// Download endpoint
app.post('/youtube-download', async (req, res) => {
  console.log('=== /youtube-download endpoint called ===');
  console.log('Request body:', req.body);
  
  const { videoUrl, format = 'mp4', quality = 'highest' } = req.body;
  
  if (!videoUrl) {
    console.error('Missing videoUrl in request');
    return res.status(400).json({
      success: false,
      error: 'Video URL is required',
      receivedBody: req.body
    });
  }

  try {
    // Validate YouTube URL
    if (!ytdl.validateURL(videoUrl)) {
      console.error('Invalid YouTube URL:', videoUrl);
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL',
        receivedUrl: videoUrl
      });
    }

    console.log(`Valid YouTube URL: ${videoUrl}`);
    
    const filePath = await downloadManager.downloadVideo(videoUrl, format, quality);
    const fileName = path.basename(filePath);

    // Read file and convert to base64
    const fileBuffer = fs.readFileSync(filePath);
    const base64File = fileBuffer.toString('base64');

    // Clean up temporary file
    try {
      fs.unlinkSync(filePath);
      console.log('Temporary file cleaned up');
    } catch (cleanupError) {
      console.warn('Could not delete temp file:', cleanupError.message);
    }

    console.log('Download completed successfully');
    
    res.json({
      success: true,
      data: {
        fileName: fileName,
        fileSize: fileBuffer.length,
        format: format,
        binaryData: base64File
      }
    });

  } catch (error) {
    console.error('Download endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      errorDetails: error.toString()
    });
  }
});

// Simple test endpoint
app.post('/test', (req, res) => {
  console.log('=== /test endpoint called ===');
  console.log('Test request body:', req.body);
  
  res.json({
    success: true,
    message: 'Test endpoint is working!',
    receivedBody: req.body,
    timestamp: new Date().toISOString()
  });
});

// Video info endpoint
app.post('/video-info', async (req, res) => {
  console.log('=== /video-info endpoint called ===');
  
  const { videoUrl } = req.body;

  if (!videoUrl) {
    return res.status(400).json({
      success: false,
      error: 'Video URL is required'
    });
  }

  try {
    if (!ytdl.validateURL(videoUrl)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL'
      });
    }

    const info = await downloadManager.getVideoInfo(videoUrl);
    
    res.json({
      success: true,
      data: {
        title: info.videoDetails.title,
        duration: info.videoDetails.lengthSeconds,
        author: info.videoDetails.author.name,
        thumbnail: info.videoDetails.thumbnails[0]?.url,
        formats: info.formats.slice(0, 5).map(f => ({
          quality: f.qualityLabel,
          mimeType: f.mimeType,
          hasAudio: f.hasAudio,
          hasVideo: f.hasVideo
        }))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'YouTube Downloader',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'YouTube Download Service is running',
    endpoints: {
      download: 'POST /youtube-download',
      info: 'POST /video-info',
      test: 'POST /test',
      health: 'GET /health'
    },
    exampleRequest: {
      url: 'POST /youtube-download',
      body: {
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        format: 'mp4',
        quality: 'highest'
      }
    }
  });
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.originalUrl} not found`,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'POST /test',
      'POST /video-info',
      'POST /youtube-download'
    ]
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 YouTube Download Service running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Available endpoints:`);
  console.log(`   GET  /health`);
  console.log(`   POST /test`);
  console.log(`   POST /video-info`);
  console.log(`   POST /youtube-download`);
});

module.exports = app;
