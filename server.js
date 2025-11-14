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

// Create downloads directory
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
    console.log(`Created downloads directory: ${downloadsDir}`);
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'youtube-download-api', 
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// YouTube download endpoint
app.post('/', async (req, res) => {
    let jobId = uuidv4();
    
    try {
        const { url, quality = '720p', maxDuration = 60 } = req.body;

        console.log(`[${jobId}] Download request:`, { url, quality });

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'YouTube URL is required'
            });
        }

        // Validate YouTube URL
        if (!ytdl.validateURL(url)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid YouTube URL'
            });
        }

        // Get video info with enhanced headers
        const info = await ytdl.getInfo(url, {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br'
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

        // Find suitable format
        let format = ytdl.chooseFormat(info.formats, {
            quality: quality === '720p' ? '22' : '18',
            filter: format => format.hasVideo && format.hasAudio
        });

        // Fallback formats
        if (!format) {
            format = ytdl.chooseFormat(info.formats, {
                quality: 'highest',
                filter: format => format.hasVideo && format.hasAudio
            });
        }

        if (!format) {
            // Last resort - any format
            format = ytdl.chooseFormat(info.formats, { quality: 'highest' });
        }

        if (!format) {
            throw new Error('No suitable video format found');
        }

        console.log(`[${jobId}] Selected format: ${format.qualityLabel}`);

        // Return download info (more reliable than downloading files)
        res.json({
            success: true,
            jobId: jobId,
            videoInfo: {
                title: videoTitle,
                duration: duration,
                quality: format.qualityLabel,
                url: url,
                author: info.videoDetails.author.name
            },
            downloadInfo: {
                downloadUrl: format.url,
                format: format.qualityLabel,
                container: format.container,
                contentLength: format.contentLength,
                estimatedSize: format.contentLength ? (format.contentLength / (1024 * 1024)).toFixed(2) + ' MB' : 'Unknown'
            },
            message: 'Video information retrieved successfully. Use downloadUrl for direct access.'
        });

    } catch (error) {
        console.error(`[${jobId}] Error:`, error.message);
        
        // Enhanced error handling
        let errorMessage = error.message;
        if (error.message.includes('410')) {
            errorMessage = 'YouTube blocked this request. Try again later or use a different video.';
        } else if (error.message.includes('404')) {
            errorMessage = 'Video not found. Check the URL.';
        } else if (error.message.includes('403')) {
            errorMessage = 'Access forbidden. Video may be private or restricted.';
        }

        res.status(500).json({
            success: false,
            error: errorMessage,
            jobId: jobId,
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

        const info = await ytdl.getInfo(url);
        
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
                viewCount: info.videoDetails.viewCount
            },
            availableFormats: formats
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test endpoint with reliable videos
app.get('/test', async (req, res) => {
    const testVideos = [
        'https://www.youtube.com/watch?v=jNQXAC9IVRw', // "Me at the zoo" - first YouTube video
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
        message: 'API Test Results',
        results: results
    });
});

// List available endpoints
app.get('/', (req, res) => {
    res.json({
        service: 'YouTube Download API',
        version: '1.0.0',
        endpoints: {
            health: 'GET /health',
            download: 'POST / { url, quality, maxDuration }',
            info: 'POST /info { url }',
            test: 'GET /test'
        },
        status: 'running'
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 YouTube Download API running on port ${PORT}`);
    console.log(`📁 Downloads directory: ${downloadsDir}`);
    console.log(`🔧 Health check: GET http://localhost:${PORT}/health`);
    console.log(`🧪 Test: GET http://localhost:${PORT}/test`);
    console.log(`📚 Docs: GET http://localhost:${PORT}/`);
});
