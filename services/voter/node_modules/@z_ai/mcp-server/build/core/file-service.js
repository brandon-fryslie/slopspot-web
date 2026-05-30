import * as fs from 'fs';
import * as path from 'path';
import { FileNotFoundError, ValidationError } from '../types/index.js';
/**
 * File operations service
 */
export class FileService {
    /**
     * Check if a string is a URL
     */
    static isUrl(source) {
        try {
            const url = new URL(source);
            return url.protocol === 'http:' || url.protocol === 'https:';
        }
        catch {
            return false;
        }
    }
    /**
     * Validate if image source exists and check size limit
     * @param imageSource Path to image file or URL
     * @param maxSizeMB Maximum file size in MB (default: 5MB)
     */
    static async validateImageSource(imageSource, maxSizeMB = 5) {
        if (this.isUrl(imageSource)) {
            return;
        }
        if (!fs.existsSync(imageSource)) {
            throw new FileNotFoundError(`Image file not found: ${imageSource}`);
        }
        const stats = fs.statSync(imageSource);
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        if (stats.size > maxSizeBytes) {
            throw new ValidationError(`Image file too large: ${(stats.size / (1024 * 1024)).toFixed(2)}MB. Maximum allowed: ${maxSizeMB}MB`);
        }
        const ext = path.extname(imageSource).toLowerCase();
        const supportedExts = ['.jpg', '.jpeg', '.png'];
        if (!supportedExts.includes(ext)) {
            throw new ValidationError(`Unsupported image format: ${ext}. Supported formats: ${supportedExts.join(', ')}`);
        }
    }
    /**
     * Validate if video source exists and check size limit
     * @param videoSource Path to video file or URL
     * @param maxSizeMB Maximum file size in MB (default: 8MB)
     */
    static async validateVideoSource(videoSource, maxSizeMB = 8) {
        if (this.isUrl(videoSource)) {
            return;
        }
        if (!fs.existsSync(videoSource)) {
            throw new FileNotFoundError(videoSource);
        }
        const stats = fs.statSync(videoSource);
        const fileSizeMB = stats.size / (1024 * 1024);
        if (fileSizeMB > maxSizeMB) {
            throw new Error(`Video file size (${fileSizeMB.toFixed(2)}MB) exceeds maximum allowed size (${maxSizeMB}MB)`);
        }
    }
    /**
     * Encode image to base64 data URL (from file or URL)
     * @param imageSource Path to image file or URL
     * @returns Base64 encoded image data or URL
     */
    static async encodeImageToBase64(imageSource) {
        if (this.isUrl(imageSource)) {
            // For URLs, return the URL directly (no base64 encoding needed)
            return imageSource;
        }
        // For local files, encode to base64
        const imageBuffer = fs.readFileSync(imageSource);
        const ext = path.extname(imageSource).toLowerCase().slice(1);
        const mimeType = this.getMimeType(ext);
        console.debug('Encoded image to base64', { imageSource, mimeType });
        return `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
    }
    /**
     * Encode video to base64 data URL (from file or URL)
     * @param videoSource Path to video file or URL
     * @returns Base64 encoded video data URL
     */
    static async encodeVideoToBase64(videoSource) {
        if (this.isUrl(videoSource)) {
            // For URLs, return the URL directly (no base64 encoding needed)
            return videoSource;
        }
        // For local files, encode to base64
        const videoBuffer = fs.readFileSync(videoSource);
        const ext = path.extname(videoSource).toLowerCase().slice(1);
        const mimeType = this.getVideoMimeType(ext);
        console.debug('Encoded video to base64', { videoSource, mimeType });
        return `data:${mimeType};base64,${videoBuffer.toString('base64')}`;
    }
    /**
     * Get MIME type for image file extension
     */
    static getMimeType(extension) {
        const mimeTypes = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg'
        };
        return mimeTypes[extension] || 'image/png';
    }
    /**
     * Get MIME type for video file extension
     * @param extension File extension without dot
     * @returns MIME type string
     */
    static getVideoMimeType(extension) {
        const mimeTypes = {
            mp4: 'video/mp4',
            avi: 'video/x-msvideo',
            mov: 'video/quicktime',
            wmv: 'video/x-ms-wmv',
            webm: 'video/webm',
            m4v: 'video/x-m4v'
        };
        return mimeTypes[extension] || 'video/mp4';
    }
}
/**
 * File service for image operations
 */
export const fileService = FileService;
