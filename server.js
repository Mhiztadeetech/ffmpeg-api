const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const ytDlpWrap = require('yt-dlp-wrap').default;
const axios = require('axios');
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

// Initialize yt-dlp
let ytDlp;
const initYtDlp = async () => {
  try {
    // Use system yt-dlp if available, otherwise download it
    const ytDlpPath = await ytDlpWrap.downloadYtDlp();
    ytDlp = new ytDlpWrap(ytDlpPath);
    console.log('✅ yt-dlp initialized successfully');
  } catch (error) {
    console.error('Failed to initialize yt-dlp:', error);
    // Fallback to using yt-dlp from system PATH
    ytDlp = new ytDlpWrap();
    console.log('🔄 Using system yt-dlp');
  }
};

class YouTubeDownloadManager {
  constructor() {
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  async getVideoInfo(videoUrl) {
    try {
      console.log(`Getting video info for: ${videoUrl}`);
      
      const userAgent = this.getRandomUserAgent();
      
      const info = await ytDlp.getVideoInfo([videoUrl], {
        dumpSingleJson: true,
        noCheckCertificates: true,
        preferFreeFormats: true,
        addHeader: [`referer:${videoUrl}`, `user-agent:${userAgent}`]
      });
      
      console.log(`✅ Successfully got info for: ${info.title}`);
      return info;
    } catch (error) {
      console.error('❌ Error getting video info:', error.message);
      throw new Error(`Failed to get video info: ${error.message}`);
    }
  }

  async downloadVideo(videoUrl, format = 'mp4', quality = 'best') {
    console.log(`Starting download: ${videoUrl}, format: ${format}, quality: ${quality}`);
    
    try {
      const info = await this.getVideoInfo(videoUrl);
      const outputPath = path.join('/tmp', `${uuidv4()}.${format}`);
      
      console.log(`Output path: ${outputPath}`);
      console.log(`Video title: ${info.title}`);

      const userAgent = this.getRandomUserAgent();
      
      // Build yt-dlp arguments
      const args = [
        videoUrl,
        '-o', outputPath,
        '--no-check-certificates',
        '--add-header', `referer:${videoUrl}`,
        '--add-header', `user-agent:${userAgent}`,
        '--force-ipv4',
        '--geo-bypass',
        '--verbose'
      ];

      // Add format options
      if (format === 'mp3' || format === 'audio') {
        args.push('--extract-audio', '--audio-format', 'mp3');
      } else {
        // For video, use best format that includes video and audio
        if (quality === 'best') {
          args.push('-f', 'best[height<=1080]');
        } else if (quality === '720p') {
          args.push('-f', 'best[height<=720]');
        } else if (quality === '480p') {
          args.push('-f', 'best[height<=480]');
        } else {
          args.push('-f', 'best');
        }
      }

      console.log('Running yt-dlp with args:', args);

      return new Promise((resolve, reject) => {
        ytDlp
          .exec(args)
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`Download progress: ${progress.percent}%`);
            }
          })
          .on('ytDlpEvent', (eventType, eventData) => {
            console.log('yt-dlp event:', eventType, eventData);
          })
          .on('error', (error) => {
            console.error('Download error:', error);
            reject(error);
          })
          .on('close', (code) => {
            if (code === 0) {
              console.log('✅ Download completed successfully');
              // Find the actual file that was created
              const files = fs.readdirSync('/tmp');
              const downloadedFile = files.find(file => file.includes(path.basename(outputPath, `.${format}`)));
              const finalPath = downloadedFile ? path.join('/tmp', downloadedFile) : outputPath;
              resolve(finalPath);
            } else {
              reject(new Error(`yt-dlp process exited with code ${code}`));
            }
          });
      });

    } catch (error) {
      console.error('Download error:', error);
      throw error;
    }
  }
}

const downloadManager = new YouTubeDownloadManager();

// Initialize yt-dlp on startup
initYtDlp();

// Download endpoint
app.post('/youtube-download', async (req, res) => {
  console.log('=== /youtube-download endpoint called ===');
  console.log('Request body:', req.body);
  
  const { videoUrl, format = 'mp4', quality = 'best' } = req.body;
  
  if (!videoUrl) {
    console.error('Missing videoUrl in request');
    return res.status(400).json({
      success: false,
      error: 'Video URL is required'
    });
  }

  // Basic YouTube URL validation
  if (!videoUrl.includes('youtube.com/watch?v=') && !videoUrl.includes('youtu.be/')) {
    return res.status(400).json({
      success: false,
      error: 'Invalid YouTube URL format'
    });
  }

  try {
    console.log(`Starting download process for: ${videoUrl}`);
    
    const filePath = await downloadManager.downloadVideo(videoUrl, format, quality);
    
    if (!fs.existsSync(filePath)) {
      throw new Error('Downloaded file not found');
    }

    const fileBuffer = fs.readFileSync(filePath);
    const stats = fs.statSync(filePath);
    
    console.log(`File downloaded: ${filePath}, size: ${stats.size} bytes`);

    const base64File = fileBuffer.toString('base64');
    const fileName = path.basename(filePath);

    // Clean up temporary file
    try {
      fs.unlinkSync(filePath);
      console.log('Temporary file cleaned up');
    } catch (cleanupError) {
      console.warn('Could not delete temp file:', cleanupError.message);
    }

    console.log('✅ Download completed successfully');
    
    res.json({
      success: true,
      data: {
        fileName: fileName,
        fileSize: fileBuffer.length,
        format: format,
        binaryData: base64File,
        mimeType: format === 'mp3' ? 'audio/mpeg' : 'video/mp4'
      }
    });

  } catch (error) {
    console.error('❌ Download endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      suggestion: 'YouTube might be blocking this video or the URL might be invalid'
    });
  }
});

// Simple info endpoint
app.post('/video-info', async (req, res) => {
  const { videoUrl } = req.body;

  if (!videoUrl) {
    return res.status(400).json({
      success: false,
      error: 'Video URL is required'
    });
  }

  try {
    const info = await downloadManager.getVideoInfo(videoUrl);
    
    res.json({
      success: true,
      data: {
        title: info.title,
        duration: info.duration,
        author: info.uploader,
        thumbnail: info.thumbnail,
        description: info.description,
        viewCount: info.view_count
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test endpoint
app.post('/test', (req, res) => {
  console.log('Test endpoint called');
  res.json({
    success: true,
    message: 'Service is working!',
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'YouTube Downloader (yt-dlp)',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'YouTube Download Service with yt-dlp',
    endpoints: {
      download: 'POST /youtube-download',
      info: 'POST /video-info', 
      test: 'POST /test',
      health: 'GET /health'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 YouTube Download Service (yt-dlp) running on port ${PORT}`);
});
