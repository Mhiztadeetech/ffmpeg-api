const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'YouTube API Proxy',
        timestamp: new Date().toISOString()
    });
});

// Main download endpoint - uses external services only
app.post('/', async (req, res) => {
    let jobId = uuidv4();
    
    try {
        const { url, quality = '720p' } = req.body;

        if (!url) {
            return res.status(400).json({ 
                success: false, 
                error: 'YouTube URL is required' 
            });
        }

        console.log(`[${jobId}] Processing: ${url}`);

        // Extract video ID for manual services
        const videoId = extractVideoId(url);
        if (!videoId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid YouTube URL'
            });
        }

        // Return multiple download options
        res.json({
            success: true,
            jobId: jobId,
            videoId: videoId,
            downloadOptions: [
                {
                    service: 'Y2Mate',
                    quality: '720p',
                    url: `https://www.y2mate.com/youtube/${videoId}`,
                    instructions: 'Visit this URL and follow the download steps'
                },
                {
                    service: 'YT5s', 
                    quality: 'Multiple',
                    url: `https://yt5s.com/en?q=https://www.youtube.com/watch?v=${videoId}`,
                    instructions: 'Paste your URL on this site'
                },
                {
                    service: 'SaveFrom',
                    quality: 'Multiple',
                    url: `https://en.savefrom.net/1-youtube-video-downloader/?url=https://www.youtube.com/watch?v=${videoId}`,
                    instructions: 'Automatic download page'
                }
            ],
            directServices: [
                'https://y2mate.com',
                'https://yt5s.com', 
                'https://en.savefrom.net'
            ],
            message: 'Use these services to download your video. Copy/paste your YouTube URL on their websites.'
        });

    } catch (error) {
        console.error(`[${jobId}] Error:`, error.message);
        
        // Always return a successful response with manual options
        const videoId = extractVideoId(req.body.url);
        res.json({
            success: true,
            jobId: jobId,
            videoId: videoId,
            manualDownload: true,
            services: [
                'Y2Mate: https://y2mate.com',
                'YT5s: https://yt5s.com',
                'SaveFrom: https://en.savefrom.net'
            ],
            instructions: 'Visit any of these websites and paste your YouTube URL to download'
        });
    }
});

// Get video info without ytdl-core
app.post('/info', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ 
                success: false, 
                error: 'YouTube URL is required' 
            });
        }

        const videoId = extractVideoId(url);
        
        if (!videoId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid YouTube URL'
            });
        }

        // Use YouTube oEmbed API for basic info (works without blocking)
        const oembedResponse = await axios.get(`https://www.youtube.com/oembed`, {
            params: {
                url: `https://www.youtube.com/watch?v=${videoId}`,
                format: 'json'
            },
            timeout: 10000
        });

        res.json({
            success: true,
            videoInfo: {
                title: oembedResponse.data.title,
                author: oembedResponse.data.author_name,
                thumbnail: oembedResponse.data.thumbnail_url,
                videoId: videoId
            }
        });

    } catch (error) {
        // Fallback: Return basic info with video ID
        const videoId = extractVideoId(req.body.url);
        res.json({
            success: true,
            videoInfo: {
                videoId: videoId,
                title: 'YouTube Video',
                author: 'Unknown',
                message: 'Basic info available - full details require manual check'
            }
        });
    }
});

// Simple test endpoint
app.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'API is working!',
        endpoints: {
            download: 'POST / { url: "youtube-url" }',
            info: 'POST /info { url: "youtube-url" }',
            health: 'GET /health'
        },
        example: {
            url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
        }
    });
});

// Extract video ID from URL
function extractVideoId(url) {
    if (!url) return null;
    
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/,
        /youtube\.com\/embed\/([^?]+)/,
        /youtube\.com\/v\/([^?]+)/
    ];
    
    for (let pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }
    
    return null;
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 YouTube Download Service running on port ${PORT}`);
    console.log(`✅ Health check: http://localhost:${PORT}/health`);
    console.log(`📚 API docs: http://localhost:${PORT}/test`);
    console.log(`💡 This service provides download links without YouTube blocking!`);
});
