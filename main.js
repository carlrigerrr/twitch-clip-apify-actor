// Twitch Clip Downloader - HTTP Only (No Browser)
import { Actor } from 'apify';
import { gotScraping } from 'got-scraping';

await Actor.init();

const input = await Actor.getInput();
const clipUrl = input.clipUrl;

console.log('Starting Twitch clip downloader (HTTP mode)...');
console.log('Clip URL:', clipUrl);

try {
    // Extract clip ID from URL
    const clipIdMatch = clipUrl.match(/clip\/([a-zA-Z0-9_-]+)/);
    if (!clipIdMatch) {
        throw new Error('Invalid clip URL format');
    }
    
    const clipId = clipIdMatch[1];
    console.log('Clip ID:', clipId);
    
    // Method 1: Try the GQL API directly
    console.log('Trying GQL API...');
    
    const gqlResponse = await gotScraping.post('https://gql.twitch.tv/gql', {
        json: {
            operationName: 'VideoAccessToken_Clip',
            variables: {
                slug: clipId
            },
            extensions: {
                persistedQuery: {
                    version: 1,
                    sha256Hash: '36b89d2507fce29e5ca551df756d27c1cfe079e2609642b4390aa4c35796eb11'
                }
            }
        },
        headers: {
            'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko'
        }
    });
    
    const gqlData = JSON.parse(gqlResponse.body);
    console.log('GQL Response received');
    
    if (gqlData.data && gqlData.data.clip && gqlData.data.clip.videoQualities) {
        const qualities = gqlData.data.clip.videoQualities;
        console.log(`Found ${qualities.length} video qualities`);
        
        // Get the best quality
        const bestQuality = qualities.find(q => q.quality === '1080') || 
                           qualities.find(q => q.quality === '720') || 
                           qualities[0];
        
        if (bestQuality && bestQuality.sourceURL) {
            await Actor.pushData({
                success: true,
                clipUrl: clipUrl,
                videoUrl: bestQuality.sourceURL,
                quality: bestQuality.quality,
                title: gqlData.data.clip.title || 'Unknown',
                creator: gqlData.data.clip.broadcaster?.displayName || 'Unknown',
                method: 'gql',
                timestamp: new Date().toISOString()
            });
            
            console.log('Success! Found video URL via GQL');
            await Actor.exit();
            return;
        }
    }
    
    // Method 2: Try alternative API
    console.log('GQL failed, trying alternative method...');
    
    const clipPageResponse = await gotScraping(clipUrl);
    const pageHtml = clipPageResponse.body;
    
    // Look for video URL in page source
    const videoUrlMatch = pageHtml.match(/https:\/\/[^"]+\.mp4[^"]*/);
    if (videoUrlMatch) {
        await Actor.pushData({
            success: true,
            clipUrl: clipUrl,
            videoUrl: videoUrlMatch[0],
            method: 'page_source',
            timestamp: new Date().toISOString()
        });
        
        console.log('Success! Found video URL in page source');
    } else {
        throw new Error('Could not find video URL with any method');
    }
    
} catch (error) {
    console.error('Error:', error.message);
    
    await Actor.pushData({
        success: false,
        clipUrl: clipUrl,
        error: error.message,
        timestamp: new Date().toISOString()
    });
}

console.log('Actor finished!');
await Actor.exit();
