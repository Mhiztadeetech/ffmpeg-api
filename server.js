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

// Create downloads directory if it doesn't exist
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
        version: '3.0.0',
        timestamp: new Date().toISOString()
    });
});

// Enhanced YouTube download with actual file download
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

        console.log(`[${jobId}] Starting YouTube download...`);

        // Get video info
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

        // Sanitize filename
        const sanitizedTitle = videoTitle.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
        const fileName = `${sanitizedTitle}_${jobId}.${format.container || 'mp4'}`;
        const filePath = path.join(downloadsDir, fileName);

        console.log(`[${jobId}] Downloading to: ${filePath}`);

        // Download and save the video
        const videoStream = ytdl.downloadFromInfo(info, { format: format });
        const writeStream = fs.createWriteStream(filePath);

        // Pipe the video stream to file
        videoStream.pipe(writeStream);

        // Handle download completion
        await new Promise((resolve, reject) => {
            writeStream.on('finish', () => {
                console.log(`[${jobId}] Download completed: ${filePath}`);
                resolve();
            });

            writeStream.on('error', (error) => {
                console.error(`[${jobId}] File write error:`, error);
                reject(new Error(`Failed to save file: ${error.message}`));
            });

            videoStream.on('error', (error) => {
                console.error(`[${jobId}] Video stream error:`, error);
                reject(new Error(`Download failed: ${error.message}`));
            });
        });

        // Get file stats
        const stats = fs.statSync(filePath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

        // Send success response
        res.json({
            success: true,
            jobId: jobId,
            videoInfo: {
                title: videoTitle,
                duration: duration,
                quality: format.qualityLabel,
                url: url
            },
            fileInfo: {
                fileName: fileName,
                filePath: filePath,
                fileSize: `${fileSizeMB} MB`,
                format: format.qualityLabel,
                container: format.container
            },
            message: 'Video downloaded successfully'
        });

    } catch (error) {
        console.error(`[${jobId}] Error processing request:`, error);
        res.status(500).json({
            success: false,
            error: error.message,
            jobId: jobId || 'unknown',
            details: 'Failed to download YouTube video'
        });
    }
});

// List downloaded files
app.get('/downloads', (req, res) => {
    try {
        const files = fs.readdirSync(downloadsDir);
        const fileList = files.map(file => {
            const filePath = path.join(downloadsDir, file);
            const stats = fs.statSync(filePath);
            return {
                name: file,
                size: `${(stats.size / (1024 * 1024)).toFixed(2)} MB`,
                created: stats.birthtime,
                path: filePath
            };
        });

        res.json({
            success: true,
            downloadDir: downloadsDir,
            files: fileList,
            totalFiles: fileList.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Download a specific file
app.get('/downloads/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(downloadsDir, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: 'File not found'
            });
        }

        res.download(filePath, filename);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Simple video info endpoint (unchanged)
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

// Test endpoint
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`YouTube Download API running on port ${PORT}`);
    console.log(`Downloads directory: ${downloadsDir}`);
    console.log(`Health check: GET http://0.0.0.0:${PORT}/health`);
    console.log(`List downloads: GET http://0.0.0.0:${PORT}/downloads`);
});
