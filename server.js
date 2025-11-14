const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// YouTube download using external service
app.post('/', async (req, res) => {
    let jobId = uuidv4();
    
    try {
        const { url, quality = '720p' } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, error: 'URL required' });
        }

        console.log(`[${jobId}] Processing: ${url}`);

        // Option 1: Use loader.to API (free, no API key needed)
        const response = await axios.get('https://loader.to/ajax/progress.php', {
            params: {
                url: url,
                format: 'mp4',
                quality: quality
            },
            timeout: 30000
        });

        if (response.data.success) {
            res.json({
                success: true,
                jobId: jobId,
                downloadUrl: response.data.download_url,
                videoInfo: {
                    title: response.data.title || 'YouTube Video',
                    duration: response.data.duration || 0
                },
                message: 'Video ready for download'
            });
        } else {
            throw new Error('External service failed');
        }

    } catch (error) {
        console.error(`[${jobId}] Error:`, error.message);
        
        // Fallback: Return basic info for manual download
        res.json({
            success: false,
            jobId: jobId,
            error: 'Download service temporarily unavailable',
            videoUrl: req.body.url,
            message: 'You can use the YouTube URL directly or try again later'
        });
    }
});

// Alternative endpoint using different service
app.post('/download', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, error: 'URL required' });
        }

        // Extract video ID for manual construction
        const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/)?.[1];
        
        if (!videoId) {
            return res.status(400).json({ success: false, error: 'Invalid YouTube URL' });
        }

        // Return manual download options
        res.json({
            success: true,
            videoId: videoId,
            downloadOptions: [
                {
                    quality: '720p',
                    url: `https://www.y2mate.com/youtube/${videoId}`,
                    service: 'y2mate.com'
                },
                {
                    quality: 'Multiple',
                    url: `https://en.y2mate.com/convert-youtube/${videoId}`,
                    service: 'y2mate.com'
                },
                {
                    quality: 'Multiple', 
                    url: `https://yt5s.com/en?q=${videoId}`,
                    service: 'yt5s.com'
                }
            ],
            message: 'Use these services to download manually'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Simple video info (still works with ytdl for basic info)
app.post('/info', async (req, res) => {
    try {
        const ytdl = require('ytdl-core');
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, error: 'URL required' });
        }

        const info = await ytdl.getInfo(url, {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        });

        res.json({
            success: true,
            videoInfo: {
                title: info.videoDetails.title,
                duration: info.videoDetails.lengthSeconds,
                author: info.videoDetails.author.name,
                viewCount: info.videoDetails.viewCount
            },
            videoId: info.videoDetails.videoId
        });

    } catch (error) {
        res.json({
            success: false,
            error: 'Could not fetch video info',
            videoUrl: req.body.url
        });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 YouTube API Proxy running on port ${PORT}`);
    console.log(`✅ Health: http://localhost:${PORT}/health`);
});
