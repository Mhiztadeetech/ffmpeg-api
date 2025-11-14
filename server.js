const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const youtubedl = require('youtube-dl-exec');

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
        version: '4.0.0',
        timestamp: new Date().toISOString()
    });
});

// Enhanced YouTube download with yt-dlp (more reliable)
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

        console.log(`[${jobId}] Starting YouTube download with yt-dlp...`);

        // Sanitize filename for output
        const outputTemplate = path.join(downloadsDir, `%(title)s_${jobId}.%(ext)s`);

        // Download options
        const options = {
            output: outputTemplate,
            format: quality === '720p' ? 'best[height<=720]' : 'best',
            maxFilesize: '500M',
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: [
                'referer:youtube.com',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            ]
        };

        // Add duration limit if specified
        if (maxDuration) {
            options.format = `best[height<=720][duration<=${maxDuration}]`;
        }

        console.log(`[${jobId}] Downloading with options:`, options);

        // Execute download
        const result = await youtubedl(url, options);

        console.log(`[${jobId}] Download completed successfully`);

        // Find the downloaded file
        const files = fs.readdirSync(downloadsDir);
        const downloadedFile = files.find(file => file.includes(jobId));
        
        if (!downloadedFile) {
            throw new Error('Downloaded file not found');
        }

        const filePath = path.join(downloadsDir, downloadedFile);
        const stats = fs.statSync(filePath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

        // Send success response
        res.json({
            success: true,
            jobId: jobId,
            videoInfo: {
                title: downloadedFile.replace(`_${jobId}`, '').replace(/\.[^/.]+$/, ""),
                url: url,
                quality: quality
            },
            fileInfo: {
                fileName: downloadedFile,
                filePath: filePath,
                fileSize: `${fileSizeMB} MB`,
                format: quality
            },
            message: 'Video downloaded successfully using yt-dlp'
        });

    } catch (error) {
        console.error(`[${jobId}] Error processing request:`, error);
        res.status(500).json({
            success: false,
            error: error.message,
            jobId: jobId || 'unknown',
            details: 'Failed to download YouTube video - signature extraction failed'
        });
    }
});

// ... rest of your endpoints remain the same
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`YouTube Download API (yt-dlp) running on port ${PORT}`);
    console.log(`Downloads directory: ${downloadsDir}`);
    console.log(`Health check: GET http://0.0.0.0:${PORT}/health`);
});
