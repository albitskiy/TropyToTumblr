'use strict';

const fs = require('fs');
const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const fetch = require('node-fetch'); // node-fetch v2
const FormData = require('form-data');

class TropyToTumblr {
  /**
   * Tropy plugin constructor.
   * @param {Object} options - from package.json "options"
   * @param {Object} context - Tropy context (logger, etc.)
   */
  constructor(options, context) {
    // Merge the user-supplied options with your plugin defaults
    this.options = {
      ...TropyToTumblr.defaults,
      ...options
    };

    // Tropy context items (logger, dialogs, etc.)
    this.context = context;
    this.logger = context.logger;

    // Destructure the merged options for convenience
    const {
      blogName,
      consumerKey,
      consumerSecret,
      token,
      tokenSecret
    } = this.options;

    // Keep them on 'this' or just use the destructured vars
    this.blogName = blogName;
    this.consumerKey = consumerKey;
    this.consumerSecret = consumerSecret;
    this.token = token;
    this.tokenSecret = tokenSecret;

    // Set up OAuth 1.0a
    this.oauth = OAuth({
      consumer: {
        key: this.consumerKey,
        secret: this.consumerSecret
      },
      signature_method: 'HMAC-SHA1',
      hash_function(baseString, key) {
        return crypto.createHmac('sha1', key).update(baseString).digest('base64');
      }
    });
  }

  /**
   * Tropy calls this "export" hook with a single JSON-LD object:
   * {
   *   "@context": {...},
   *   "@graph": [ ... ],
   *   "version": "1.x.x"
   * }
   */
  async export(data) {
    this.logger.info('TropyToTumblr.export() received data:', data);

    if (!data || !Array.isArray(data['@graph']) || data['@graph'].length === 0) {
      this.logger.info('No items found in the Tropy export data.');
      return;
    }

    // Gather local image paths + any tags from each item
    const photoPaths = [];
    const allTags = new Set();

    for (const node of data['@graph']) {
      // Photos
      if (Array.isArray(node.photo)) {
        for (const p of node.photo) {
          if (p.path && fs.existsSync(p.path)) {
            photoPaths.push(p.path);
          }
        }
      }
      // Tags
      if (Array.isArray(node.tag)) {
        node.tag.forEach(tag => allTags.add(tag));
      }
    }

    if (photoPaths.length === 0) {
      this.logger.info('No local photos found among the selected items.');
      return;
    }

    // Convert to array (Tumblr wants comma-separated tags)
    const tagArray = Array.from(allTags);

    this.logger.info(
      `Posting ${photoPaths.length} photo(s) to Tumblr blog "${this.blogName}" with tags:`,
      tagArray
    );

    try {
      const result = await this.postPhotosToTumblr(photoPaths, '', tagArray);
      this.logger.info('Posted to Tumblr successfully:', result);
    } catch (err) {
      this.logger.error('Failed to post photos to Tumblr:', err.message || err);
    }
  }

  /**
   * Post multiple photos as a single "photo" post to Tumblr,
   * optionally including Tropy tags as Tumblr tags.
   */
  async postPhotosToTumblr(photoPaths, caption, tags = []) {
    const url = `https://api.tumblr.com/v2/blog/${this.blogName}.tumblr.com/post`;

    // Create multipart/form-data
    const form = new FormData();
    form.append('type', 'photo');
    // Use empty caption so no text is shown
    form.append('caption', caption);

    // Add tags as a comma-separated list
    if (tags.length > 0) {
      form.append('tags', tags.join(','));
    }

    // Add each photo path as "data[]"
    for (const filepath of photoPaths) {
      form.append('data[]', fs.createReadStream(filepath));
    }

    // Prepare OAuth headers
    const requestData = { url, method: 'POST', data: {} };
    const tokenObj = { key: this.token, secret: this.tokenSecret };
    const oauthHeaders = this.oauth.toHeader(
      this.oauth.authorize(requestData, tokenObj)
    );
    const fetchHeaders = { ...oauthHeaders, ...form.getHeaders() };

    // Make the request
    const response = await fetch(url, {
      method: 'POST',
      headers: fetchHeaders,
      body: form
    });

    let json;
    try {
      json = await response.json();
    } catch (parseErr) {
      throw new Error(`Tumblr response is not valid JSON: ${parseErr}`);
    }

    if (!response.ok) {
      throw new Error(
        `Tumblr API error (status=${response.status}): ${JSON.stringify(json)}`
      );
    }

    // Return the success response
    return json;
  }
}

/**
 * Defaults, similar to how the ArchivePlugin sets them.
 * These values get merged with user-supplied "options" from Tropy's Preferences.
 */
TropyToTumblr.defaults = {
  blogName: 'YOUR_BLOG_NAME',
  consumerKey: 'YOUR_DEFAULT_CONSUMER_KEY',
  consumerSecret: 'YOUR_DEFAULT_CONSUMER_SECRET',
  token: 'YOUR_DEFAULT_TOKEN',
  tokenSecret: 'YOUR_DEFAULT_TOKEN_SECRET'
};

module.exports = TropyToTumblr;
