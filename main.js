// Twitch Clip Downloader - Apify Actor
import { Actor } from 'apify';
import { PuppeteerCrawler } from 'crawlee';

await Actor.init();

const input = await Actor.getInput();
const clipUrl = input.clipUrl;

console.log('Starting Twitch clip downloader...');
console.log('Clip URL:', clipUrl);

const crawler = new PuppeteerCrawler({
    launchContext: {
        launchOptions: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    },
    
    async requestHandler({ page, request }) {
        console.log('Opening Twitch clip page...');
        
        try {
            // Go to the page
            await page.goto(clipUrl, { waitUntil: 'networkidle2' });
            
            // Wait for video to load
            await page.waitForSelector('video', { timeout: 30000 });
            console.log('Video player found!');
            
            // Set up network interception to catch video URLs
            const videoUrls = [];
            
            page.on('response', response => {
                const url = response.url();
                if (url.includes('.mp4') || url.includes('video-edge')) {
                    videoUrls.push(url);
                    console.log('Found potential video URL:', url.substring(0, 80) + '...');
                }
            });
            
            // Wait for page to fully load
            await page.waitForTimeout(3000);
            
            // Try to extract video info from the page
            const pageData = await page.evaluate(() => {
                const video = document.querySelector('video');
                let videoUrl = video ? video.src : null;
                
                // Get title
                let title = 'Unknown Title';
                const titleEl = document.querySelector('h2') || 
                               document.querySelector('[data-a-target="stream-title"]');
                if (titleEl) {
                    title = titleEl.textContent.trim();
                }
                
                // Get creator
                let creator = 'Unknown Creator';
                const creatorEl = document.querySelector('[data-a-target="stream-info-card-channel-link"]') ||
                                 document.querySelector('a[href*="/videos"]');
                if (creatorEl) {
                    creator = creatorEl.textContent.trim();
                }
                
                return {
                    videoUrl: videoUrl,
                    title: title,
                    creator: creator
                };
            });
            
            // If we got a blob URL, reload to catch network requests
            if (pageData.videoUrl && pageData.videoUrl.startsWith('blob:')) {
                console.log('Got blob URL, reloading to catch network requests...');
                await page.reload({ waitUntil: 'networkidle2' });
                await page.waitForTimeout(5000);
            }
            
            // Find the best video URL
            let finalVideoUrl = pageData.videoUrl;
            if (videoUrls.length > 0) {
                // Prefer URLs with .mp4 extension
                const mp4Urls = videoUrls.filter(url => url.includes('.mp4'));
                if (mp4Urls.length > 0) {
                    // Sort by length (longer URLs often have auth tokens)
                    mp4Urls.sort((a, b) => b.length - a.length);
                    finalVideoUrl = mp4Urls[0];
                } else {
                    finalVideoUrl = videoUrls[0];
                }
            }
            
            // Make sure we have a valid URL
            if (!finalVideoUrl || finalVideoUrl.startsWith('blob:')) {
                throw new Error('Could not find valid video URL');
            }
            
            // Save successful result
            const result = {
                success: true,
                clipUrl: clipUrl,
                videoUrl: finalVideoUrl,
                title: pageData.title,
                creator: pageData.creator,
                timestamp: new Date().toISOString()
            };
            
            await Actor.pushData(result);
            console.log('Success! Video URL extracted:', result);
            
        } catch (error) {
            console.error('Error:', error.message);
            
            // Save error result
            await Actor.pushData({
                success: false,
                clipUrl: clipUrl,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    },
    
    maxRequestRetries: 2,
    navigationTimeoutSecs: 60,
});

// Run the crawler
await crawler.run([clipUrl]);

console.log('Actor finished!');
await Actor.exit();
