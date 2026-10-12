const form = document.querySelector('#download-form');
const input = document.querySelector('#video-url');
const button = document.querySelector('#fetch-button');
const status = document.querySelector('#status');
const youtubePreview = document.querySelector('#youtube-preview');
const youtubeFrame = youtubePreview.querySelector('iframe');

function setStatus(message, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
  status.hidden = false;
}

function filenameFrom(url) {
  const segment = new URL(url).pathname.split('/').filter(Boolean).at(-1);
  try {
    return decodeURIComponent(segment || 'video');
  } catch {
    return segment || 'video';
  }
}

function isYouTubeHost(hostname) {
  return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(hostname);
}

function youtubeVideoId(url) {
  if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0];
  const pathParts = url.pathname.split('/').filter(Boolean);
  if (url.pathname === '/watch') return url.searchParams.get('v');
  if (['shorts', 'embed', 'live', 'v'].includes(pathParts[0])) return pathParts[1];
  return null;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  let source;
  try {
    source = new URL(input.value.trim());
    if (!['http:', 'https:'].includes(source.protocol)) throw new Error();
  } catch {
    setStatus('Enter a complete HTTP or HTTPS video URL.', 'error');
    input.focus();
    return;
  }

  youtubePreview.hidden = true;
  youtubeFrame.src = 'about:blank';
  if (isYouTubeHost(source.hostname)) {
    const videoId = youtubeVideoId(source);
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      setStatus('Enter a YouTube video URL: watch, youtu.be, Shorts, live, or embed.', 'error');
      return;
    }
    youtubeFrame.src = `https://www.youtube-nocookie.com/embed/${videoId}`;
    youtubePreview.hidden = false;
    setStatus('YouTube video ready to preview. Downloads are handled by YouTube where available.');
    return;
  }

  button.disabled = true;
  button.querySelector('span:last-child').textContent = 'Fetching…';
  setStatus('Connecting to the source…');

  let saveHandle;
  try {
    if ('showSaveFilePicker' in window) {
      saveHandle = await window.showSaveFilePicker({ suggestedName: filenameFrom(source.href) });
    }

    const downloadUrl = `/api/download?url=${encodeURIComponent(source.href)}`;
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'The video could not be fetched.');
    }

    const total = Number(response.headers.get('Content-Length'));
    if (saveHandle) {
      const writer = await saveHandle.createWritable();
      let received = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
          received += value.byteLength;
          setStatus(total ? `Saving video… ${Math.floor((received / total) * 100)}%` : `Saving video… ${formatBytes(received)}`);
        }
        await writer.close();
      } catch (error) {
        await writer.abort();
        throw error;
      }
    } else {
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filenameFrom(source.href);
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    }

    setStatus('Video saved successfully.');
  } catch (error) {
    if (error.name === 'AbortError') {
      setStatus('Save cancelled.');
    } else {
      setStatus(error.message || 'Something went wrong while fetching the video.', 'error');
    }
  } finally {
    button.disabled = false;
    button.querySelector('span:last-child').textContent = 'Fetch video';
  }
});

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB received`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB received`;
}