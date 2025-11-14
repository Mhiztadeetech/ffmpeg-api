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

// Rate limiting and block mitigation
const downloadAttempts = new Map();
const MAX_ATTEMPTS = 5;
const TIME_WINDOW = 60000; // 1 minute

class YouTubeDownloadManager {
  constructor() {
    this.currentProxyIndex = 0;
  }

  getNextProxy() {
    // Use environment variables for proxies
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
      const options = {
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        }
      };

      // Add proxy if available
      const proxy = this.getNextProxy();
      if (proxy) {
        options.requestOptions.proxy = proxy;
      }

      const info = await ytdl.getInfo(videoUrl, options);
      return info;
    } catch (error) {
      console.error('Error getting video info:', error.message);
      throw new Error(`Failed to get video info: ${error.message}`);
    }
  }

  async downloadVideo(videoUrl, format = 'mp4', quality = 'highest') {
    const videoId = ytdl.getVideoID(videoUrl);
    
    // Rate limiting check
    if (this.isRateLimited(videoId)) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    try {
      const info = await this.getVideoInfo(videoUrl);
      const outputPath = path.join('/tmp', `${uuidv4()}.${format}`);
      
      console.log(`Downloading: ${info.videoDetails.title}`);
      console.log(`Format: ${format}, Quality: ${quality}`);

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

      // Add proxy if available
      const proxy = this.getNextProxy();
      if (proxy) {
        options.requestOptions.proxy = proxy;
      }

      // Set filter based on format
      if (format === 'mp3' || format === 'audio') {
        options.filter = 'audioonly';
      } else {
        options.filter = 'videoandaudio';
      }

      return new Promise((resolve, reject) => {
        const videoStream = ytdl(videoUrl, options);

        if (format === 'mp3') {
          // Convert to MP3
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
          // Direct download for other formats
          const writeStream = fs.createWriteStream(outputPath);
          
          videoStream.pipe(writeStream);
          
          writeStream.on('finish', () => {
            console.log('Download completed');
            resolve(outputPath);
          });
          writeStream.on('error', reject);
        }

        videoStream.on('error', reject);
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
    
    // Clean old attempts
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

// Routes
app.post('/youtube-download', async (req, res) => {
  const { videoUrl, format = 'mp4', quality = 'highest' } = req.body;
  
  if (!videoUrl) {
    return res.status(400).json({
      success: false,
      error: 'Video URL is required'
    });
  }

  try {
    // Validate YouTube URL
    if (!ytdl.validateURL(videoUrl)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL'
      });
    }

    console.log(`Starting download for: ${videoUrl}`);
    
    const filePath = await downloadManager.downloadVideo(videoUrl, format, quality);
    const fileName = path.basename(filePath);

    // Read file and convert to base64 for N8N
    const fileBuffer = fs.readFileSync(filePath);
    const base64File = fileBuffer.toString('base64');

    // Clean up temporary file
    try {
      fs.unlinkSync(filePath);
    } catch (cleanupError) {
      console.warn('Could not delete temp file:', cleanupError.message);
    }

    // Return success response for N8N
    res.json({
      success: true,
      data: {
        fileName: fileName,
        fileSize: fileBuffer.length,
        format: format,
        downloadUrl: `data:application/octet-stream;base64,${base64File}`,
        binaryData: base64File
      }
    });

  } catch (error) {
    console.error('Download endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      retrySuggested: error.message.includes('rate limit') || error.message.includes('blocked')
    });
  }
});

// Get video info endpoint
app.post('/video-info', async (req, res) => {
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
        formats: info.formats.map(f => ({
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

// Health check endpoint
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
      health: 'GET /health'
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`YouTube Download Service running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
