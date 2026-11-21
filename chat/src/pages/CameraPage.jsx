import { useCallback, useEffect, useRef, useState } from "react";

const CameraIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 4h-4l-2 3H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
    <circle cx="12" cy="13" r="3" />
  </svg>
);

const SwitchIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a3 3 0 0 1 3-3h15" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a3 3 0 0 1-3 3H3" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);

const CameraPage = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [facingMode, setFacingMode] = useState("environment");
  const [status, setStatus] = useState("starting");
  const [error, setError] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async (mode = facingMode) => {
    stopCamera();
    setStatus("starting");
    setError("");
    setPhotoUrl("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("Camera access is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;

      const devices = await navigator.mediaDevices.enumerateDevices();
      setHasMultipleCameras(devices.filter((device) => device.kind === "videoinput").length > 1);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("ready");
    } catch (cameraError) {
      setStatus("error");
      if (cameraError?.name === "NotAllowedError" || cameraError?.name === "PermissionDeniedError") {
        setError("Camera permission was denied. Allow camera access in your browser settings and try again.");
      } else if (cameraError?.name === "NotFoundError") {
        setError("No camera was found on this device.");
      } else if (cameraError?.name === "NotReadableError") {
        setError("The camera is already in use by another application.");
      } else {
        setError("Could not start the camera. Please try again.");
      }
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []); // Start once; cleanup is handled on unmount.

  useEffect(() => {
    if (!photoUrl) return undefined;
    return () => URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || status !== "ready") return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setPhotoUrl(URL.createObjectURL(blob));
    }, "image/jpeg", 0.92);
  };

  const flipCamera = () => {
    const nextMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextMode);
    startCamera(nextMode);
  };

  const retake = () => setPhotoUrl("");

  return (
    <main style={styles.page}>
      <div style={styles.cameraShell}>
        <div style={styles.preview}>
          {photoUrl ? (
            <img src={photoUrl} alt="Captured photo" style={styles.previewMedia} />
          ) : (
            <video ref={videoRef} muted autoPlay playsInline style={styles.previewMedia} />
          )}

          {status === "starting" && (
            <div style={styles.stateOverlay}>
              <div style={styles.loader} />
              <p style={styles.stateText}>Starting camera...</p>
            </div>
          )}

          {status === "error" && (
            <div style={styles.stateOverlay}>
              <div style={styles.errorIcon}><CameraIcon size={30} /></div>
              <p style={styles.errorTitle}>Camera unavailable</p>
              <p style={styles.stateText}>{error}</p>
              <button type="button" style={styles.retryButton} onClick={() => startCamera()}>Try again</button>
            </div>
          )}

          <canvas ref={canvasRef} style={{ display: "none" }} />

          {status === "ready" && !photoUrl && (
            <div style={styles.controls}>
              {hasMultipleCameras && (
                <button type="button" style={styles.sideButton} onClick={flipCamera} aria-label="Switch camera" title="Switch camera">
                  <SwitchIcon />
                </button>
              )}
              <button type="button" style={styles.captureButton} onClick={capturePhoto} aria-label="Take photo">
                <span style={styles.captureInner} />
              </button>
              {hasMultipleCameras ? <div style={styles.sideSpacer} /> : null}
            </div>
          )}

          {photoUrl && (
            <div style={styles.photoControls}>
              <button type="button" style={styles.photoAction} onClick={retake}>Retake</button>
              <a href={photoUrl} download={`camera-${Date.now()}.jpg`} style={{ ...styles.photoAction, ...styles.downloadAction }}>
                <DownloadIcon />
                Save
              </a>
            </div>
          )}
        </div>
      </div>
    </main>
  );
};

const styles = {
  page: {
    minHeight: "100%",
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    background: "#09090b",
  },
  cameraShell: {
    width: "min(100%, 920px)",
  },
  preview: {
    position: "relative",
    width: "100%",
    aspectRatio: "16 / 9",
    minHeight: "320px",
    maxHeight: "calc(100vh - 170px)",
    overflow: "hidden",
    borderRadius: "18px",
    background: "#111113",
    border: "1px solid #27272a",
  },
  previewMedia: {
    width: "100%",
    height: "100%",
    display: "block",
    objectFit: "cover",
  },
  stateOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    textAlign: "center",
    background: "rgba(9, 9, 11, 0.82)",
  },
  loader: {
    width: "38px",
    height: "38px",
    border: "3px solid rgba(255,255,255,0.16)",
    borderTopColor: "#2563eb",
    borderRadius: "50%",
  },
  stateText: {
    maxWidth: "420px",
    margin: "12px 0 0",
    color: "#a1a1aa",
    lineHeight: 1.5,
  },
  errorIcon: {
    width: "58px",
    height: "58px",
    display: "grid",
    placeItems: "center",
    borderRadius: "50%",
    color: "#dbeafe",
    background: "rgba(37,99,235,0.18)",
  },
  errorTitle: {
    margin: "14px 0 0",
    fontSize: "18px",
    fontWeight: 700,
  },
  retryButton: {
    marginTop: "18px",
    height: "42px",
    padding: "0 18px",
    border: 0,
    borderRadius: "10px",
    background: "#2563eb",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: "22px",
    display: "grid",
    gridTemplateColumns: "56px 72px 56px",
    justifyContent: "center",
    alignItems: "center",
    gap: "18px",
  },
  sideButton: {
    width: "56px",
    height: "56px",
    display: "grid",
    placeItems: "center",
    border: "1px solid rgba(255,255,255,0.24)",
    borderRadius: "50%",
    background: "rgba(24,24,27,0.72)",
    color: "#fff",
    cursor: "pointer",
  },
  sideSpacer: {
    width: "56px",
  },
  captureButton: {
    width: "72px",
    height: "72px",
    display: "grid",
    placeItems: "center",
    borderRadius: "50%",
    border: "4px solid rgba(255,255,255,0.95)",
    background: "rgba(255,255,255,0.18)",
    cursor: "pointer",
  },
  captureInner: {
    width: "58px",
    height: "58px",
    borderRadius: "50%",
    background: "#fff",
  },
  photoControls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: "22px",
    display: "flex",
    justifyContent: "center",
    gap: "12px",
  },
  photoAction: {
    height: "44px",
    minWidth: "96px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    border: "1px solid rgba(255,255,255,0.28)",
    borderRadius: "10px",
    background: "rgba(24,24,27,0.82)",
    color: "#fff",
    fontSize: "14px",
    fontWeight: 700,
    textDecoration: "none",
    cursor: "pointer",
  },
  downloadAction: {
    border: 0,
    background: "#2563eb",
  },
};

export default CameraPage;