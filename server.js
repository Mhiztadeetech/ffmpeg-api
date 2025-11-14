const express = require('express');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create downloads directory
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
}

// Enhanced request options with rotating user agents
const getRandomUserAgent = () => {
    const agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
    ];
    return agents[Math.floor(Math.random() * agents.length)];
};

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.post('/', async (req, res) => {
    let jobId = uuidv4();
    
    try {
        const { url, quality = '720p', maxDuration = 60 } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, error: 'URL required' });
        }

        console.log(`[${jobId}] Processing: ${url}`);

        // Enhanced request configuration
        const requestOptions = {
            requestOptions: {
                headers: {
                    'User-Agent': getRandomUserAgent(),
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Cache-Control': 'max-age=0'
                },
                timeout: 30000
            }
        };

        const info = await ytdl.getInfo(url, requestOptions);
        const videoTitle = info.videoDetails.title;
        const duration = parseInt(info.videoDetails.lengthSeconds);

        if (maxDuration && duration > maxDuration) {
            return res.status(400).json({
                success: false,
                error: `Video too long: ${duration}s > ${maxDuration}s limit`
            });
        }

        // Try multiple format selection strategies
        let format = ytdl.chooseFormat(info.formats, {
            quality: '22', // 720p mp4
            filter: format => format.hasVideo && format.hasAudio
        });

        if (!format) {
            format = ytdl.chooseFormat(info.formats, {
                quality: '18', // 360p mp4
                filter: format => format.hasVideo && format.hasAudio
            });
        }

        if (!format) {
            format = ytdl.chooseFormat(info.formats, {
                quality: 'highest',
                filter: format => format.hasVideo && format.hasAudio
            });
        }

        if (!format) {
            throw new Error('No suitable format found');
        }

        console.log(`[${jobId}] Format: ${format.qualityLabel}`);

        // Return download info instead of downloading (more reliable)
        res.json({
            success: true,
            jobId: jobId,
            videoInfo: {
                title: videoTitle,
                duration: duration,
                quality: format.qualityLabel,
                url: url
            },
            downloadInfo: {
                downloadUrl: format.url,
                format: format.qualityLabel,
                container: format.container,
                contentLength: format.contentLength
            },
            message: 'Video info retrieved. Use downloadUrl for direct download.'
        });

    } catch (error) {
        console.error(`[${jobId}] Error:`, error.message);
        res.status(500).json({
            success: false,
            error: `YouTube blocked the request: ${error.message}`,
            jobId: jobId,
            details: 'Try again later or use a different video'
        });
    }
});

// Alternative endpoint that returns info without downloading
app.post('/info', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ success: false, error: 'URL required' });
        }

        const info = await ytdl.getInfo(url);
        
        res.json({
            success: true,
            videoInfo: {
                title: info.videoDetails.title,
                duration: info.videoDetails.lengthSeconds,
                author: info.videoDetails.author.name,
                viewCount: info.videoDetails.viewCount
            },
            formats: info.formats
                .filter(f => f.hasVideo && f.hasAudio)
                .map(f => ({
                    quality: f.qualityLabel,
                    container: f.container,
                    contentLength: f.contentLength,
                    url: f.url
                }))
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
