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
    version: '3.0.0',
    timestamp: new Date().toISOString()
  });
});

// Enhanced YouTube download with multiple fallbacks
app.post('/', async (req, res) => {
  let jobId;
  
  try {
    const {
      url,
      quality = '720p',
      maxDuration = 60
    } = req.body;

    console.log('Download request received:', { url, quality });

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'YouTube URL is required'
      });
    }

    // Generate unique job ID
    jobId = uuidv4();

    try {
      console.log(`[${jobId}] Starting YouTube download...`);

      // Method 1: Try ytdl-core with updated options
      const info = await ytdl.getInfo(url, {
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          }
        }
      });

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

      // Find the best format
      let format;
      if (quality === '720p') {
        format = ytdl.chooseFormat(info.formats, {
          quality: 'highest',
          filter: format => format.qualityLabel === '720p' && format.hasVideo && format.hasAudio
        });
      } else {
        format = ytdl.chooseFormat(info.formats, {
          quality: 'highest',
          filter: format => format.hasVideo && format.hasAudio
        });
      }

      if (!format) {
        // Fallback: get any format with video and audio
        format = ytdl.chooseFormat(info.formats, {
          quality: 'highest',
          filter: format => format.hasVideo && format.hasAudio
        });
      }

      if (!format) {
        throw new Error('No suitable video format found');
      }

      console.log(`[${jobId}] Selected format: ${format.qualityLabel}`);

      // Return video info and download URL instead of downloading
      res.json({
        success: true,
        jobId: jobId,
        videoInfo: {
          title: videoTitle,
          duration: duration,
          quality: format.qualityLabel,
          url: url,
          downloadUrl: format.url, // Direct download URL
          container: format.container
        },
        fileInfo: {
          estimatedSize: format.contentLength ? (format.contentLength / (1024 * 1024)).toFixed(2) + 'MB' : 'Unknown',
          format: format.qualityLabel
        },
        message: 'Video information retrieved successfully. Use the downloadUrl for direct download.'
      });

    } catch (downloadError) {
      console.error(`[${jobId}] Download error:`, downloadError.message);
      
      // Fallback: Return basic video info without download
      try {
        const basicInfo = await ytdl.getBasicInfo(url);
        res.json({
          success: false,
          error: 'Download failed, but here is video info',
          jobId: jobId,
          videoInfo: {
            title: basicInfo.videoDetails.title,
            duration: basicInfo.videoDetails.lengthSeconds,
            url: url
          },
          fallback: true,
          message: 'YouTube signature extraction failed. Video can be downloaded manually from the provided URL.'
        });
      } catch (basicError) {
        throw new Error(`YouTube access failed: ${downloadError.message}`);
      }
    }

  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      jobId: jobId || 'unknown',
      details: 'Failed to process YouTube video'
    });
  }
});

// Simple video info endpoint
app.post('/info', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'YouTube URL is required'
      });
    }

    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    });

    const formats = info.formats
      .filter(f => f.hasVideo && f.hasAudio)
      .map(f => ({
        quality: f.qualityLabel,
        container: f.container,
        contentLength: f.contentLength,
        url: f.url
      }));

    res.json({
      success: true,
      videoInfo: {
        title: info.videoDetails.title,
        duration: info.videoDetails.lengthSeconds,
        author: info.videoDetails.author.name,
        viewCount: info.videoDetails.viewCount,
        thumbnails: info.videoDetails.thumbnails
      },
      availableFormats: formats
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

// Test endpoint with multiple videos
app.post('/test', async (req, res) => {
  const testVideos = [
    'https://www.youtube.com/watch?v=jNQXAC9IVRw', // Me at the zoo (short, reliable)
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ', // YouTube test video
  ];

  const results = [];

  for (const testUrl of testVideos) {
    try {
      const info = await ytdl.getInfo(testUrl);
      results.push({
        url: testUrl,
        success: true,
        title: info.videoDetails.title,
        duration: info.videoDetails.lengthSeconds
      });
    } catch (error) {
      results.push({
        url: testUrl,
        success: false,
        error: error.message
      });
    }
  }

  res.json({
    success: true,
    message: 'YouTube API compatibility test',
    results: results
  });
});

// Simple echo endpoint
app.post('/echo', (req, res) => {
  res.json({
    success: true,
    message: 'Request received',
    body: req.body,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`YouTube Download API running on port ${PORT}`);
  console.log(`Health check: GET http://0.0.0.0:${PORT}/health`);
  console.log(`Test endpoint: POST http://0.0.0.0:${PORT}/test`);
});
