// Twitch Clip Downloader - Memory Optimized
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
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--single-process',
                '--no-zygote'
            ]
        }
    },
    
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 120,
    
    async requestHandler({ page, request }) {
        console.log('Opening Twitch clip page...');
        
        try {
            // Block unnecessary resources to save memory
            await page.setRequestInterception(true);
            
            const blockedResources = ['image', 'stylesheet', 'font'];
            page.on('request', (request) => {
                if (blockedResources.includes(request.resourceType())) {
                    request.abort();
                } else {
                    request.continue();
                }
            });
            
            // Set up network interception for video URLs
            const videoUrls = [];
            page.on('response', response => {
                const url = response.url();
                if (url.includes('.mp4') || url.includes('video-edge') || url.includes('v1/segment')) {
                    videoUrls.push(url);
                    console.log('Found video URL:', url.substring(0, 80) + '...');
                }
            });
            
            // Navigate with longer timeout
            console.log('Navigating to page...');
            await page.goto(clipUrl, { 
                waitUntil: 'domcontentloaded',
                timeout: 60000 
            });
            
            // Wait for video element
            console.log('Waiting for video player...');
            await page.waitForSelector('video', { timeout: 30000 });
            console.log('Video player found!');
            
            // Small delay to let video URL load
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Extract page data
            const pageData = await page.evaluate(() => {
                const video = document.querySelector('video');
                const videoUrl = video ? video.src : null;
                
                // Get title
                let title = 'Unknown Title';
                const titleSelectors = [
                    'h2[data-a-target="stream-title"]',
                    'h2',
                    '[class*="title"]'
                ];
                
                for (const selector of titleSelectors) {
                    const el = document.querySelector(selector);
                    if (el && el.textContent) {
                        title = el.textContent.trim();
                        break;
                    }
                }
                
                // Get creator
                let creator = 'Unknown Creator';
                const creatorSelectors = [
                    '[data-a-target="stream-info-card-channel-link"]',
                    'a[href*="/videos"]',
                    '[class*="channel"] a'
                ];
                
                for (const selector of creatorSelectors) {
                    const el = document.querySelector(selector);
                    if (el && el.textContent) {
                        creator = el.textContent.trim();
                        break;
                    }
                }
                
                return { videoUrl, title, creator };
            });
            
            // Process video URLs
            let finalVideoUrl = pageData.videoUrl;
            
            // If we have intercepted URLs, use the best one
            if (videoUrls.length > 0) {
                console.log(`Found ${videoUrls.length} potential video URLs`);
                
                // Prefer .mp4 URLs
                const mp4Urls = videoUrls.filter(url => url.includes('.mp4'));
                if (mp4Urls.length > 0) {
                    // Sort by length (longer = more likely to have auth tokens)
                    mp4Urls.sort((a, b) => b.length - a.length);
                    finalVideoUrl = mp4Urls[0];
                } else if (videoUrls.length > 0) {
                    // Use any video URL we found
                    finalVideoUrl = videoUrls[videoUrls.length - 1];
                }
            }
            
            // If still blob URL, try one more approach
            if (finalVideoUrl && finalVideoUrl.startsWith('blob:')) {
                console.log('Got blob URL, trying alternate method...');
                
                // Clear previous URLs
                videoUrls.length = 0;
                
                // Reload and wait
                await page.reload({ waitUntil: 'domcontentloaded' });
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // Check if we got new URLs
                if (videoUrls.length > 0) {
                    const mp4Urls = videoUrls.filter(url => url.includes('.mp4'));
                    if (mp4Urls.length > 0) {
                        finalVideoUrl = mp4Urls[0];
                    } else {
                        finalVideoUrl = videoUrls[0];
                    }
                }
            }
            
            // Validate final URL
            if (!finalVideoUrl || finalVideoUrl.startsWith('blob:')) {
                throw new Error('Could not extract valid video URL');
            }
            
            // Success!
            const result = {
                success: true,
                clipUrl: clipUrl,
                videoUrl: finalVideoUrl,
                title: pageData.title,
                creator: pageData.creator,
                timestamp: new Date().toISOString()
            };
            
            console.log('Success! Extracted video URL');
            console.log('Title:', result.title);
            console.log('Creator:', result.creator);
            console.log('Video URL:', result.videoUrl.substring(0, 100) + '...');
            
            await Actor.pushData(result);
            
        } catch (error) {
            console.error('Error:', error.message);
            
            await Actor.pushData({
                success: false,
                clipUrl: clipUrl,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    },
    
    maxRequestRetries: 2,
    maxConcurrency: 1,
});

// Run the crawler
await crawler.run([clipUrl]);

console.log('Actor finished!');
await Actor.exit();
