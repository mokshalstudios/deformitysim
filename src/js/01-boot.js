    window.__spineModuleReady = false;
    window.__showSpine3dError = function (message) {
      const loading = document.getElementById('loadingState');
      const error = document.getElementById('canvasError');
      const copy = document.getElementById('canvasErrorMessage');
      if (loading) loading.hidden = true;
      if (copy && message) copy.textContent = message;
      if (error) error.hidden = false;
    };
    document.getElementById('retryVisualization')?.addEventListener('click', () => window.location.reload());
    window.setTimeout(() => {
      if (!window.__spineModuleReady) {
        window.__showSpine3dError('The embedded 3D engine did not finish starting. Reload the app; if this persists, confirm WebGL and hardware acceleration are enabled.');
      }
    }, 10000);
