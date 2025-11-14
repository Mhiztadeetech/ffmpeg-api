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

// Enhanced YouTube download with ytdl-core workaround
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

        // Updated ytdl-core configuration to handle signature extraction
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

        // Find the best format
        let format = ytdl.chooseFormat(info.formats, {
            quality: quality === '720p' ? '22' : '18', // 22=720p, 18=360p
            filter: format => format.hasVideo && format.hasAudio
        });

        // Fallback to any format with video and audio
        if (!format) {
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

        // Download with updated options
        const videoStream = ytdl(url, {
            format: format,
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        });

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

// ... keep the rest of your endpoints (downloads, info, etc.)

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`YouTube Download API running on port ${PORT}`);
    console.log(`Downloads directory: ${downloadsDir}`);
    console.log(`Health check: GET http://0.0.0.0:${PORT}/health`);
});
