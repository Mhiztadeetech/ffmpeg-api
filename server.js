const express = require('express');
const router = express.Router();
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Rate limiting and block mitigation
const downloadAttempts = new Map();
const MAX_ATTEMPTS = 5;
const TIME_WINDOW = 60000; // 1 minute

// Proxy rotation (configure your proxy list)
const PROXY_LIST = [
  process.env.PROXY_1,
  process.env.PROXY_2,
  // Add more proxies as needed
].filter(Boolean);

class YouTubeDownloadManager {
  constructor() {
    this.currentProxyIndex = 0;
  }

  getNextProxy() {
    if (PROXY_LIST.length === 0) return null;
    this.currentProxyIndex = (this.currentProxyIndex + 1) % PROXY_LIST.length;
    return PROXY_LIST[this.currentProxyIndex];
  }

  async getVideoInfo(videoUrl) {
    try {
      const info = await ytdl.getInfo(videoUrl, {
        requestOptions: {
          proxy: this.getNextProxy(),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        }
      });
      return info;
    } catch (error) {
      throw new Error(`Failed to get video info: ${error.message}`);
    }
  }

  async downloadVideo(videoUrl, format = 'mp4', quality = 'highest') {
    const videoId = ytdl.getVideoID(videoUrl);
    const attemptKey = `${videoId}-${Date.now()}`;
    
    // Rate limiting check
    if (this.isRateLimited(videoId)) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    try {
      const info = await this.getVideoInfo(videoUrl);
      const outputPath = path.join(__dirname, 'downloads', `${uuidv4()}.${format}`);
      
      // Ensure downloads directory exists
      if (!fs.existsSync(path.dirname(outputPath))) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      }

      return new Promise((resolve, reject) => {
        const videoStream = ytdl(videoUrl, {
          quality: quality,
          filter: format === 'audio' ? 'audioonly' : 'videoandaudio',
          requestOptions: {
            proxy: this.getNextProxy(),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': '*/*',
              'Accept-Encoding': 'identity',
              'Range': 'bytes=0-'
            }
          }
        });

        if (format === 'mp3') {
          // Convert to MP3
          ffmpeg(videoStream)
            .audioBitrate(128)
            .toFormat('mp3')
            .on('error', reject)
            .on('end', () => resolve(outputPath))
            .save(outputPath);
        } else {
          // Direct download
          const writeStream = fs.createWriteStream(outputPath);
          videoStream.pipe(writeStream);
          
          writeStream.on('finish', () => resolve(outputPath));
          writeStream.on('error', reject);
        }

        videoStream.on('error', reject);
      });

    } catch (error) {
      this.recordAttempt(videoId);
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

// N8N Webhook Endpoint
router.post('/youtube-download', async (req, res) => {
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

    // For N8N response - return file buffer or download URL
    const fileBuffer = fs.readFileSync(filePath);
    const base64File = fileBuffer.toString('base64');

    // Clean up file
    fs.unlinkSync(filePath);

    // Return success response for N8N
    res.json({
      success: true,
      data: {
        fileName: fileName,
        fileSize: fileBuffer.length,
        format: format,
        downloadUrl: `data:application/octet-stream;base64,${base64File}`,
        // Alternatively, you can return the file as binary data
        binaryData: base64File
      }
    });

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      retrySuggested: error.message.includes('rate limit') || error.message.includes('blocked')
    });
  }
});

// Get video info endpoint
router.post('/video-info', async (req, res) => {
  const { videoUrl } = req.body;

  try {
    const info = await downloadManager.getVideoInfo(videoUrl);
    
    res.json({
      success: true,
      data: {
        title: info.videoDetails.title,
        duration: info.videoDetails.lengthSeconds,
        author: info.videoDetails.author.name,
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
router.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'YouTube Downloader',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
