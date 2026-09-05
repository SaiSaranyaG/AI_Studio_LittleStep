import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Compass,
  Camera,
  Upload,
  Layers,
  Sparkles,
  Sun,
  ShieldCheck,
  AlertTriangle,
  Info,
  CheckCircle2,
  Sliders,
  ChevronRight,
  RefreshCw,
  X,
  Droplets,
  Wind,
  Thermometer,
  AlertCircle,
  Eye,
  SwitchCamera,
  Sparkle,
  Image as ImageIcon,
  Grid,
  Zap,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { SpaceZone, SpaceProfile } from '../../types';
import balconySampleImg from '../../assets/images/story_balcony_oasis_1788194436360.jpg';
import nookSampleImg from '../../assets/images/story_growing_nook_1788194416149.jpg';
import cornerSampleImg from '../../assets/images/story_empty_corner_1788194380921.jpg';
import {
  optimizeImageForSpaceAnalysis,
  ImageOptimizationResult,
  formatBytes,
} from '../../utils/imageCompression';

type AnalyzerState = 'EMPTY' | 'IMAGE_SELECTED' | 'ANALYZING' | 'RESULT' | 'ERROR';

export const SpaceScannerView: React.FC = () => {
  const {
    spaces,
    activeSpace,
    setActiveSpace,
    isScanningSpace,
    scanSpacePhoto,
    confirmSpace,
    setActiveTab,
  } = useApp();
  const { user } = useAuth();

  // Core Analyzer State Machine
  const [analyzerState, setAnalyzerState] = useState<AnalyzerState>(() => {
    return activeSpace.analysis ? 'RESULT' : 'EMPTY';
  });

  const [selectedImage, setSelectedImage] = useState<string | null>(activeSpace.photoUrl || null);
  const [imageMeta, setImageMeta] = useState<{
    name: string;
    sizeKb: number;
    source: 'upload' | 'camera' | 'sample';
  } | null>(null);
  const [optimizationStats, setOptimizationStats] = useState<ImageOptimizationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Configuration Inputs
  const [selectedSpaceType, setSelectedSpaceType] = useState<string>('auto');
  const [referenceBenchmark, setReferenceBenchmark] = useState('');
  const [selectedZone, setSelectedZone] = useState<SpaceZone | null>(activeSpace.zones?.[0] || null);

  // Calibration State
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [editSpaceName, setEditSpaceName] = useState(activeSpace.name || 'Scanned Space');
  const [editSpaceType, setEditSpaceType] = useState<SpaceProfile['spaceType']>(activeSpace.spaceType || 'indoor_room');
  const [editLength, setEditLength] = useState(activeSpace.lengthFt || 8);
  const [editWidth, setEditWidth] = useState(activeSpace.widthFt || 6);
  const [editLighting, setEditLighting] = useState<string>(activeSpace.analysis?.lighting?.classification || 'BRIGHT_INDIRECT');
  const [editingZones, setEditingZones] = useState<SpaceZone[]>(activeSpace.zones || []);
  const [calibrationSuccess, setCalibrationSuccess] = useState(false);

  // 2D Map View Mode: Photo Spatial Overlay (grounded in uploaded photo) or 2D Blueprint Grid
  const [mapViewMode, setMapViewMode] = useState<'photo_overlay' | 'blueprint'>('photo_overlay');

  // In-Browser Live Camera State
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync active space selection with UI
  useEffect(() => {
    if (activeSpace) {
      setEditSpaceName(activeSpace.name || 'Scanned Space');
      setEditSpaceType(activeSpace.spaceType || 'indoor_room');
      setEditLength(activeSpace.lengthFt || 8);
      setEditWidth(activeSpace.widthFt || 6);
      setEditLighting(activeSpace.analysis?.lighting?.classification || 'BRIGHT_INDIRECT');
      setEditingZones(activeSpace.zones || []);
      setSelectedZone(activeSpace.zones?.[0] || null);
      if (activeSpace.photoUrl) {
        setSelectedImage(activeSpace.photoUrl);
      }
      if (activeSpace.analysis) {
        setAnalyzerState('RESULT');
      }
    }
  }, [activeSpace]);

  // Clean up camera stream
  const stopCameraStream = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      mediaStreamRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, [stopCameraStream]);

  // Start in-browser camera
  const startCamera = async (mode: 'environment' | 'user' = facingMode) => {
    setCameraError(null);
    stopCameraStream();

    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError('Camera API is not supported in this browser. Please upload a photo instead.');
      fileInputRef.current?.click();
      return;
    }

    try {
      setIsCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err: any) {
      console.warn('[SpaceAnalyzer] Camera access error:', err);
      stopCameraStream();
      let msg = 'Camera access was denied. You can upload a photo from your gallery instead.';
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'No camera device found. Please upload an image file instead.';
      } else if (err.name === 'NotReadableError') {
        msg = 'Camera is in use by another application. Please upload a photo instead.';
      }
      setCameraError(msg);
      // Fall back to gallery input
      fileInputRef.current?.click();
    }
  };

  // Capture current frame from live camera
  const capturePhoto = async () => {
    if (!videoRef.current || !mediaStreamRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const rawBase64 = canvas.toDataURL('image/jpeg', 0.9);
    
    // Lightweight downscaling and compression before storing & sending
    const opt = await optimizeImageForSpaceAnalysis(rawBase64, {
      maxDimension: 1024,
      quality: 0.82,
    });

    stopCameraStream();
    setSelectedImage(opt.dataUrl);
    setOptimizationStats(opt);
    setImageMeta({
      name: `camera_capture_${new Date().toISOString().slice(11, 19).replace(/:/g, '-')}.jpg`,
      sizeKb: Math.round(opt.compressedSizeBytes / 1024),
      source: 'camera',
    });
    setAnalyzerState('IMAGE_SELECTED');
    setErrorMessage(null);
  };

  // Switch between back/front camera
  const toggleFacingMode = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    startCamera(nextMode);
  };

  // Handle local gallery file upload with client-side downscaling/compression
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validation
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Unsupported file format. Please choose a JPEG, PNG, or WebP photo.');
      setAnalyzerState('ERROR');
      return;
    }

    const sizeKb = Math.round(file.size / 1024);
    if (sizeKb > 15360) {
      setErrorMessage('Image exceeds the 15MB limit. Please select a smaller photo.');
      setAnalyzerState('ERROR');
      return;
    }

    try {
      // Downscale and compress client-side in sub-50ms before sending to API
      const opt = await optimizeImageForSpaceAnalysis(file, {
        maxDimension: 1024,
        quality: 0.82,
      });

      setSelectedImage(opt.dataUrl);
      setOptimizationStats(opt);
      setImageMeta({
        name: file.name,
        sizeKb: Math.round(opt.compressedSizeBytes / 1024),
        source: 'upload',
      });
      setAnalyzerState('IMAGE_SELECTED');
      setErrorMessage(null);
    } catch (err: any) {
      console.error('[SpaceScanner] Error optimizing uploaded file:', err);
      setErrorMessage('Failed to read image file. Please try another photo.');
      setAnalyzerState('ERROR');
    }

    // Reset file input value so user can reselect the same file if desired
    e.target.value = '';
  };

  // Sample quick images
  const sampleScans = [
    {
      name: 'Sunlit Urban Balcony',
      type: 'balcony' as const,
      url: balconySampleImg,
      benchmark: 'Standard balcony railing height = 3.5 ft',
      description: 'High direct morning sunlight & safety perimeter',
    },
    {
      name: 'Window Sill Plant Nook',
      type: 'indoor_room' as const,
      url: nookSampleImg,
      benchmark: 'Window sill span = 4.5 ft',
      description: 'Bright filtered indirect light with window sill',
    },
    {
      name: 'Shaded Patio Corner',
      type: 'patio' as const,
      url: cornerSampleImg,
      benchmark: 'Paved terrace tile = 1.0 ft x 1.0 ft',
      description: 'Gentle ambient light with floor protection',
    },
  ];

  const handleSelectSample = async (sample: (typeof sampleScans)[0]) => {
    try {
      setSelectedSpaceType(sample.type);
      setReferenceBenchmark(sample.benchmark);

      const resp = await fetch(sample.url);
      const blob = await resp.blob();
      const opt = await optimizeImageForSpaceAnalysis(blob, {
        maxDimension: 1024,
        quality: 0.82,
      });

      setSelectedImage(opt.dataUrl);
      setOptimizationStats(opt);
      setImageMeta({
        name: `${sample.name}.jpg`,
        sizeKb: Math.round(opt.compressedSizeBytes / 1024),
        source: 'sample',
      });
      setAnalyzerState('IMAGE_SELECTED');
      setErrorMessage(null);
    } catch {
      setSelectedImage(sample.url);
      setOptimizationStats(null);
      setImageMeta({
        name: `${sample.name}.jpg`,
        sizeKb: 512,
        source: 'sample',
      });
      setAnalyzerState('IMAGE_SELECTED');
      setErrorMessage(null);
    }
  };

  // Submit image for AI Vision Analysis
  const handleAnalyzeSpace = async () => {
    if (!selectedImage) {
      setErrorMessage('No photo selected. Please upload or take a photo first.');
      setAnalyzerState('ERROR');
      return;
    }

    setAnalyzerState('ANALYZING');
    setErrorMessage(null);

    try {
      // Ensure image is fully downscaled and compressed for minimal Gemini latency
      const imageToSend = optimizationStats?.dataUrl || selectedImage;

      // Generous timeout safeguard (50s) so analyzing state never hangs indefinitely
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                'Space analysis took longer than expected. Please check your network connection and retry.'
              )
            ),
          50000
        )
      );

      const createdSpace = await Promise.race([
        scanSpacePhoto(imageToSend, selectedSpaceType, referenceBenchmark),
        timeoutPromise,
      ]);

      setActiveSpace(createdSpace);
      setEditSpaceName(createdSpace.name || 'Scanned Space');
      setEditSpaceType(createdSpace.spaceType || 'indoor_room');
      setEditLength(createdSpace.lengthFt || 8);
      setEditWidth(createdSpace.widthFt || 6);
      setEditLighting(createdSpace.analysis?.lighting?.classification || 'BRIGHT_INDIRECT');
      setEditingZones(createdSpace.zones || []);
      setSelectedZone(createdSpace.zones?.[0] || null);
      if (createdSpace.photoUrl) {
        setSelectedImage(createdSpace.photoUrl);
      }
      setAnalyzerState('RESULT');
    } catch (err: any) {
      console.error('[SpaceAnalyzer] Analysis error caught in view:', err);
      setErrorMessage(
        err?.message ||
          "We couldn't analyze this image. Please try a clearer photo with visible room boundaries and lighting."
      );
      setAnalyzerState('ERROR');
    }
  };

  // Reset to initial scan state
  const handleResetScanner = () => {
    stopCameraStream();
    setSelectedImage(null);
    setImageMeta(null);
    setOptimizationStats(null);
    setErrorMessage(null);
    setAnalyzerState('EMPTY');
  };

  // Save manual calibration
  const handleSaveCalibration = () => {
    confirmSpace(
      activeSpace.id,
      Number(editLength),
      Number(editWidth),
      editingZones,
      {
        name: editSpaceName,
        spaceType: editSpaceType,
        lightingClassification: editLighting as any,
      }
    );
    setCalibrationSuccess(true);
    setTimeout(() => setCalibrationSuccess(false), 3500);
    setIsCalibrating(false);
  };

  const analysis = activeSpace.analysis;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Hidden Canvas for Camera Frame Capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/jpeg,image/png,image/webp,image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Live Camera Viewfinder Modal */}
      {isCameraActive && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-between p-4 sm:p-6 animate-fadeIn">
          {/* Header Controls */}
          <div className="w-full max-w-2xl flex items-center justify-between text-white z-10">
            <div className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-emerald-400" />
              <span className="font-semibold text-sm">Space Analyzer Camera</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleFacingMode}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-emerald-300 transition-colors cursor-pointer"
                title="Switch Camera"
              >
                <SwitchCamera className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={stopCameraStream}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                title="Cancel"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Viewfinder Frame */}
          <div className="relative w-full max-w-2xl aspect-[4/3] rounded-2xl overflow-hidden border-2 border-emerald-500/50 bg-black flex items-center justify-center shadow-2xl my-auto">
            <video
              ref={videoRef}
              playsInline
              autoPlay
              muted
              className="w-full h-full object-cover"
            />
            {/* Viewfinder Guides */}
            <div className="absolute inset-0 pointer-events-none border border-white/20 m-6 rounded-xl">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-emerald-400" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-emerald-400" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-emerald-400" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-emerald-400" />
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-white/80 bg-black/40 py-1 backdrop-blur-xs">
                Frame your window, floor, and natural light sources
              </div>
            </div>
          </div>

          {/* Bottom Snap Button */}
          <div className="w-full max-w-2xl flex items-center justify-center gap-4 py-4 z-10">
            <button
              type="button"
              id="capture-camera-photo-btn"
              onClick={capturePhoto}
              className="w-18 h-18 rounded-full border-4 border-white bg-emerald-500 hover:bg-emerald-400 active:scale-95 flex items-center justify-center shadow-lg transition-all cursor-pointer"
              title="Capture Photo"
            >
              <div className="w-12 h-12 rounded-full bg-white shadow-inner" />
            </button>
          </div>
        </div>
      )}

      {/* Top Banner & Active Space Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-emerald-900/40 p-6 rounded-2xl border border-emerald-800/60">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
            <Compass className="w-4 h-4" />
            <span>AI Multimodal Spatial Perception</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mt-1">
            LittleStep Space Analyzer & 2D Mapper
          </h1>
          <p className="text-emerald-200/80 text-sm mt-1 max-w-2xl">
            Real Gemini Vision analysis evaluates sunlight availability, window exposure, and safe plant placement before calculating capacity.
          </p>
        </div>

        {/* Space Selector */}
        {spaces.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="text-xs text-emerald-300 font-medium whitespace-nowrap">Active Space:</label>
            <select
              id="active-space-select"
              value={activeSpace.id}
              onChange={(e) => {
                const sp = spaces.find((s) => s.id === e.target.value);
                if (sp) {
                  setActiveSpace(sp);
                  setEditLength(sp.lengthFt || 8);
                  setEditWidth(sp.widthFt || 6);
                  setEditingZones(sp.zones || []);
                  setSelectedZone(sp.zones?.[0] || null);
                  if (sp.analysis) {
                    setAnalyzerState('RESULT');
                  }
                }
              }}
              className="bg-emerald-950 border border-emerald-700/70 text-emerald-100 text-sm rounded-xl px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.usableAreaSqFt} sq.ft)
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Photo Input, State Machine & AI Analysis (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-emerald-950/60 rounded-2xl p-6 border border-emerald-800/60 space-y-5">
            {/* Header with status badge */}
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Camera className="w-5 h-5 text-emerald-400" />
                <span>Space Photo & Sunlight Analysis</span>
              </h2>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-800/60 text-emerald-300 font-mono">
                {analyzerState}
              </span>
            </div>

            {/* STATE 1: EMPTY STATE */}
            {analyzerState === 'EMPTY' && (
              <div className="space-y-4">
                {/* Dropzone & Selector */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="relative aspect-video rounded-xl border-2 border-dashed border-emerald-700/70 hover:border-emerald-500/90 bg-emerald-900/20 hover:bg-emerald-900/40 transition-all p-6 flex flex-col items-center justify-center text-center cursor-pointer group"
                >
                  <div className="w-12 h-12 rounded-full bg-emerald-800/50 group-hover:bg-emerald-700/60 flex items-center justify-center text-emerald-300 mb-3 transition-colors">
                    <Upload className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-white">
                    Select a photo or drag and drop here
                  </p>
                  <p className="text-xs text-emerald-300/70 mt-1">
                    Supports JPEG, PNG, WebP (up to 10MB)
                  </p>
                </div>

                {/* Input Buttons */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    id="take-camera-photo-btn"
                    onClick={() => startCamera('environment')}
                    className="flex items-center justify-center gap-2 py-3 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-emerald-950 font-bold text-xs shadow-md transition-all cursor-pointer"
                  >
                    <Camera className="w-4 h-4 shrink-0" />
                    <span>Take Photo (Camera)</span>
                  </button>
                  <button
                    type="button"
                    id="upload-space-photo-btn"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 py-3 px-3 rounded-xl bg-emerald-900/80 hover:bg-emerald-800 border border-emerald-700/60 text-emerald-100 font-bold text-xs shadow-md transition-all cursor-pointer"
                  >
                    <Upload className="w-4 h-4 shrink-0" />
                    <span>Upload (Gallery)</span>
                  </button>
                </div>

                {cameraError && (
                  <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>{cameraError}</span>
                  </div>
                )}

                {/* Space Type Selector */}
                <div className="grid grid-cols-2 gap-2.5 pt-2">
                  <div>
                    <label className="text-xs text-emerald-300/90 mb-1 block font-medium">
                      Space Type
                    </label>
                    <select
                      id="scan-space-type-select"
                      value={selectedSpaceType}
                      onChange={(e) => setSelectedSpaceType(e.target.value)}
                      className="w-full bg-emerald-900/80 border border-emerald-700/60 text-emerald-100 text-xs rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="auto">✨ Auto-Detect (Indoor vs Outdoor)</option>
                      <option value="indoor_room">Indoor Living Room / Bedroom</option>
                      <option value="window_nook">Window Sill Nook</option>
                      <option value="balcony">Balcony / Railing</option>
                      <option value="patio">Patio / Courtyard</option>
                      <option value="terrace">Terrace / Rooftop</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-emerald-300/90 mb-1 block font-medium">
                      Scale Benchmark (Optional)
                    </label>
                    <input
                      id="scan-benchmark-input"
                      type="text"
                      placeholder="e.g. Door = 3ft, Railing = 3.5ft"
                      value={referenceBenchmark}
                      onChange={(e) => setReferenceBenchmark(e.target.value)}
                      className="w-full bg-emerald-900/80 border border-emerald-700/60 text-emerald-100 text-xs rounded-lg px-2.5 py-2 placeholder:text-emerald-600 outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                {/* Quick Sample Environments */}
                <div className="pt-3 border-t border-emerald-800/50">
                  <p className="text-xs font-semibold text-emerald-400 mb-2">
                    Or select a sample space photo:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {sampleScans.map((sample) => (
                      <button
                        key={sample.name}
                        type="button"
                        id={`sample-scan-${sample.type}`}
                        onClick={() => handleSelectSample(sample)}
                        className="text-left p-2 rounded-lg bg-emerald-900/50 hover:bg-emerald-800/70 border border-emerald-700/50 text-emerald-200 transition-colors text-xs space-y-1 cursor-pointer"
                      >
                        <span className="font-semibold block truncate">{sample.name}</span>
                        <span className="text-[10px] text-emerald-300/70 block leading-tight">
                          {sample.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* STATE 2: IMAGE SELECTED STATE (Review before sending) */}
            {analyzerState === 'IMAGE_SELECTED' && selectedImage && (
              <div className="space-y-4">
                <div className="relative aspect-video rounded-xl overflow-hidden border border-emerald-700/70 bg-emerald-950 shadow-md">
                  <img
                    src={selectedImage}
                    alt="Space preview"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-xs text-[11px] text-emerald-200 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{imageMeta?.name || 'Photo Ready'}</span>
                    {imageMeta?.sizeKb ? <span>({imageMeta.sizeKb} KB)</span> : null}
                  </div>
                </div>

                {/* Pre-scan configuration: Space Type & Benchmark */}
                <div className="grid grid-cols-2 gap-2.5 p-3 rounded-xl bg-emerald-950/70 border border-emerald-800/60">
                  <div>
                    <label className="text-[11px] text-emerald-300/90 mb-1 block font-medium">
                      Space Type Target
                    </label>
                    <select
                      id="selected-space-type-select"
                      value={selectedSpaceType}
                      onChange={(e) => setSelectedSpaceType(e.target.value)}
                      className="w-full bg-emerald-900/90 border border-emerald-700/60 text-emerald-100 text-xs rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="auto">✨ Auto-Detect (Indoor vs Outdoor)</option>
                      <option value="indoor_room">Indoor Living Room / Bedroom</option>
                      <option value="window_nook">Window Sill Nook</option>
                      <option value="balcony">Balcony / Railing</option>
                      <option value="patio">Patio / Courtyard</option>
                      <option value="terrace">Terrace / Rooftop</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-emerald-300/90 mb-1 block font-medium">
                      Scale Benchmark (Optional)
                    </label>
                    <input
                      id="selected-benchmark-input"
                      type="text"
                      placeholder="e.g. Standard door (3ft)"
                      value={referenceBenchmark}
                      onChange={(e) => setReferenceBenchmark(e.target.value)}
                      className="w-full bg-emerald-900/90 border border-emerald-700/60 text-emerald-100 text-xs rounded-lg px-2 py-1.5 placeholder:text-emerald-600 outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                {/* Lightweight Downscaling/Compression Metrics Pill */}
                {optimizationStats && optimizationStats.originalSizeBytes > 0 && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-emerald-950/80 border border-emerald-700/60 text-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
                        <Zap className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-emerald-100 font-semibold flex items-center gap-1.5">
                          <span>Payload Optimized for Gemini Vision</span>
                        </p>
                        <p className="text-emerald-300/80 text-[11px]">
                          {formatBytes(optimizationStats.originalSizeBytes)} → {formatBytes(optimizationStats.compressedSizeBytes)} • {optimizationStats.width}×{optimizationStats.height}px
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <span className="px-2 py-0.5 rounded-md bg-emerald-900/90 text-emerald-300 font-mono font-bold text-[11px] border border-emerald-700/60 whitespace-nowrap">
                        -{optimizationStats.reductionPercentage}% payload
                      </span>
                      <span className="text-[10px] text-emerald-400/80 font-mono">
                        {optimizationStats.durationMs}ms
                      </span>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <button
                    type="button"
                    id="submit-space-analysis-btn"
                    onClick={handleAnalyzeSpace}
                    disabled={isScanningSpace}
                    className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-emerald-950 font-bold text-sm shadow-lg flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4 shrink-0" />
                    <span>Analyze Space & Sunlight Conditions</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 py-2 rounded-lg bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 text-xs font-medium border border-emerald-700/60 transition-colors cursor-pointer"
                    >
                      Choose Different Photo
                    </button>
                    <button
                      type="button"
                      onClick={handleResetScanner}
                      className="px-3 py-2 rounded-lg bg-emerald-950 hover:bg-emerald-900 text-emerald-400 text-xs font-medium border border-emerald-800/60 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STATE 3: ANALYZING STATE (Loading indicator with cancel safeguard) */}
            {analyzerState === 'ANALYZING' && (
              <div className="py-12 px-4 rounded-xl border border-emerald-700/50 bg-emerald-900/30 flex flex-col items-center justify-center text-center space-y-4 animate-fadeIn">
                <div className="relative">
                  <div className="w-14 h-14 rounded-full border-4 border-emerald-500/30 border-t-emerald-400 animate-spin" />
                  <Sparkle className="w-6 h-6 text-emerald-300 absolute inset-0 m-auto animate-pulse" />
                </div>
                <div className="space-y-1">
                  <p className="text-base font-bold text-white">
                    Analyzing Space & Sunlight Conditions...
                  </p>
                  <p className="text-xs text-emerald-300/80 max-w-sm">
                    Gemini Vision is inspecting direct sunlight rays, window placement, room boundaries, and environmental airflow cues.
                  </p>
                </div>
                <div className="w-full max-w-xs space-y-1.5 text-[11px] text-emerald-300/70 pt-2 font-mono text-left">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>1. Pre-compressed image payload delivered</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>2. Inspecting sunlight intensity & windows...</span>
                  </div>
                  <div className="flex items-center gap-2 text-emerald-500">
                    <span className="w-2 h-2 rounded-full bg-emerald-700" />
                    <span>3. Tailoring plant zones & dimensions</span>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAnalyzerState('IMAGE_SELECTED');
                    }}
                    className="px-4 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 text-xs border border-emerald-700/60 transition-colors cursor-pointer"
                  >
                    Cancel Analysis
                  </button>
                </div>
              </div>
            )}

            {/* STATE 4: RESULT STATE - Space & Sunlight Summary */}
            {analyzerState === 'RESULT' && (
              <div className="space-y-4 animate-fadeIn">
                {/* Image thumbnail with change action */}
                <div className="relative aspect-video rounded-xl overflow-hidden border border-emerald-700/60 bg-emerald-950">
                  {selectedImage || activeSpace.photoUrl ? (
                    <img
                      src={selectedImage || activeSpace.photoUrl}
                      alt={activeSpace.name}
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                  <div className="absolute top-2 right-2">
                    <button
                      type="button"
                      onClick={handleResetScanner}
                      className="p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-emerald-300 text-xs backdrop-blur-xs flex items-center gap-1 cursor-pointer transition-colors"
                      title="Scan another photo"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>New Photo</span>
                    </button>
                  </div>
                </div>

                {/* Overall Status Banner */}
                {analysis && (
                  <div
                    className={`p-4 rounded-xl border flex items-start gap-3 ${
                      analysis.overallStatus === 'GOOD'
                        ? 'bg-emerald-900/40 border-emerald-500/70 text-emerald-100'
                        : analysis.overallStatus === 'MODERATE'
                        ? 'bg-teal-950/50 border-teal-600/70 text-teal-100'
                        : analysis.overallStatus === 'POOR'
                        ? 'bg-amber-950/40 border-amber-600/70 text-amber-100'
                        : 'bg-slate-900/50 border-slate-700 text-slate-200'
                    }`}
                  >
                    <div className="p-2 rounded-lg bg-emerald-950/60 shrink-0">
                      <Sun className="w-5 h-5 text-amber-400" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm">
                          Space Status: {analysis.overallStatus.replace('_', ' ')}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/40 font-mono">
                          {Math.round((analysis.confidence || activeSpace.confidence) * 100)}% Confidence
                        </span>
                      </div>
                      <p className="text-xs opacity-90">
                        {analysis.evidence || analysis.lighting?.lightEvidence}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STATE 5: ERROR STATE */}
            {analyzerState === 'ERROR' && (
              <div className="p-5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-100 space-y-4 animate-fadeIn">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-bold text-sm text-white">Space Analysis Notice</h3>
                    <p className="text-xs text-rose-200/90 mt-1">
                      {errorMessage ||
                        "We couldn't analyze this image. Please try a clearer photo with visible lighting and room boundaries."}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedImage) {
                        handleAnalyzeSpace();
                      } else {
                        fileInputRef.current?.click();
                      }
                    }}
                    className="flex-1 py-2 px-3 rounded-lg bg-rose-800 hover:bg-rose-700 text-white font-semibold text-xs transition-colors cursor-pointer"
                  >
                    Retry Analysis
                  </button>
                  <button
                    type="button"
                    onClick={handleResetScanner}
                    className="py-2 px-3 rounded-lg bg-emerald-950 hover:bg-emerald-900 border border-emerald-800 text-emerald-200 text-xs transition-colors cursor-pointer"
                  >
                    Upload Another Photo
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Environmental Observations & Limitations */}
          {analysis && (
            <div className="bg-emerald-950/60 rounded-2xl p-6 border border-emerald-800/60 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Environmental & Lighting Clues</span>
                </h3>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-800/80 text-emerald-200">
                  {analysis.lightType} Light
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-emerald-900/40 border border-emerald-800/50 space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
                    <Droplets className="w-3.5 h-3.5 text-teal-400" />
                    <span>Humidity Observation</span>
                  </div>
                  <p className="text-emerald-200/80 leading-relaxed">
                    {analysis.environment?.humidityAssessment || 'Moderate ambient room humidity.'}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-emerald-900/40 border border-emerald-800/50 space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
                    <Wind className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Airflow Assessment</span>
                  </div>
                  <p className="text-emerald-200/80 leading-relaxed">
                    {analysis.environment?.airflowAssessment || 'Natural ambient indoor circulation.'}
                  </p>
                </div>
              </div>

              {/* Temperature Constraint Notice */}
              <div className="p-3 rounded-xl bg-emerald-900/20 border border-emerald-800/40 flex items-start gap-2.5 text-xs text-emerald-300/80">
                <Thermometer className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-emerald-200">Temperature Policy: </span>
                  <span>
                    Ambient temperature requires physical sensor or user telemetry; not estimated from static photos.
                  </span>
                </div>
              </div>

              {/* Limitations */}
              {analysis.limitations && (
                <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-700/50 flex items-start gap-2.5 text-xs text-slate-300">
                  <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-white">Visual Limitations: </span>
                    <span>{analysis.limitations}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Recommended Plants & 2D Space Map (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Recommended Plants Card based on Analyzed Sunlight */}
          {analysis && analysis.plantRecommendations && analysis.plantRecommendations.length > 0 && (
            <div className="bg-emerald-950/70 rounded-2xl p-6 border border-emerald-800/60 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-amber-400" />
                    <span>AI-Recommended Plants for this Space</span>
                  </h2>
                  <p className="text-xs text-emerald-300/80 mt-0.5">
                    Selected based on {analysis.sunlightStatus.toLowerCase()} sunlight and {analysis.lightType.toLowerCase()} light conditions
                  </p>
                </div>
                <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-800/60 text-emerald-300 font-semibold">
                  {analysis.plantRecommendations.length} Species
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {analysis.plantRecommendations.map((plant, index) => (
                  <div
                    key={index}
                    className="p-4 rounded-xl bg-emerald-900/50 hover:bg-emerald-900/70 border border-emerald-700/50 transition-all space-y-2 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-bold text-sm text-white">{plant.name}</h4>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-semibold font-mono shrink-0 ${
                            plant.careLevel === 'EASY'
                              ? 'bg-emerald-800 text-emerald-200'
                              : plant.careLevel === 'MEDIUM'
                              ? 'bg-teal-800 text-teal-200'
                              : 'bg-amber-800 text-amber-200'
                          }`}
                        >
                          {plant.careLevel} CARE
                        </span>
                      </div>
                      <p className="text-xs text-emerald-200/90 mt-1 leading-relaxed">
                        {plant.reason}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-emerald-800/40 text-[11px] space-y-1">
                      <div className="flex items-center gap-1 text-amber-300">
                        <Sun className="w-3 h-3 shrink-0" />
                        <span className="truncate">{plant.lightRequirement}</span>
                      </div>
                      {plant.placementSuggestion && (
                        <div className="text-emerald-300/80 text-[10px] italic">
                          Placement: {plant.placementSuggestion}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2D Green Space Map & Zones */}
          <div className="bg-emerald-950/70 rounded-2xl p-6 border border-emerald-800/60 space-y-6">
            {/* Header & Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-emerald-400" />
                  <h2 className="text-lg font-bold text-white">
                    2D Green Space Map
                  </h2>
                  <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-800/80 text-emerald-200 border border-emerald-700/60 capitalize font-medium">
                    {activeSpace.spaceType.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-xs text-emerald-300/80 mt-0.5">
                  <span className="text-white font-semibold">{activeSpace.name}</span>: {isCalibrating ? editLength : (activeSpace.lengthFt || 8)} ft x {isCalibrating ? editWidth : (activeSpace.widthFt || 6)} ft • {isCalibrating ? Math.round(editLength * editWidth * 0.75) : (activeSpace.usableAreaSqFt || 24)} sq.ft usable • {activeSpace.plantCapacityEstimate || 4} plant capacity
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Toggle View Mode: Photo Spatial Overlay vs Architectural Grid */}
                <div className="flex items-center bg-emerald-900/80 p-1 rounded-xl border border-emerald-700/60 text-xs">
                  <button
                    type="button"
                    onClick={() => setMapViewMode('photo_overlay')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                      mapViewMode === 'photo_overlay'
                        ? 'bg-emerald-500 text-emerald-950 font-bold shadow-sm'
                        : 'text-emerald-200 hover:text-white'
                    }`}
                    title="View zones mapped directly onto your uploaded space photo"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>Photo Overlay</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMapViewMode('blueprint')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                      mapViewMode === 'blueprint'
                        ? 'bg-emerald-500 text-emerald-950 font-bold shadow-sm'
                        : 'text-emerald-200 hover:text-white'
                    }`}
                    title="View architectural coordinate blueprint"
                  >
                    <Grid className="w-3.5 h-3.5" />
                    <span>Blueprint Grid</span>
                  </button>
                </div>

                <button
                  type="button"
                  id="calibrate-dimensions-btn"
                  onClick={() => setIsCalibrating(!isCalibrating)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isCalibrating
                      ? 'bg-amber-500 text-amber-950 shadow-md font-bold'
                      : 'bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/60'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>{isCalibrating ? 'Close Calibrate' : 'Calibrate Space & Zones'}</span>
                </button>
              </div>
            </div>

            {/* Calibration Success Feedback */}
            {calibrationSuccess && (
              <div className="p-3 rounded-xl bg-emerald-900/90 border border-emerald-500 text-emerald-100 text-xs flex items-center gap-2 animate-fadeIn shadow-md">
                <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
                <span className="font-semibold">
                  Space profile, zones, and dimensions successfully calibrated and saved!
                </span>
              </div>
            )}

            {/* Human-in-the-Loop Space & Dimensions Calibration Studio */}
            {isCalibrating && (
              <div className="p-5 rounded-2xl bg-amber-950/50 border border-amber-800/70 space-y-4 animate-fadeIn shadow-lg">
                <div className="flex items-start gap-2.5 pb-2 border-b border-amber-900/60">
                  <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-200">
                    <p className="font-semibold text-amber-300">
                      Adaptive Calibration Studio
                    </p>
                    <p className="text-[11px] text-amber-200/80 mt-0.5">
                      Adjust your space identity, exact architectural dimensions, sunlight orientation, or fine-tune plant zones below. All recommendations dynamically re-balance.
                    </p>
                  </div>
                </div>

                {/* Section 1: Space Identity & Room Classification */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="text-xs text-amber-200 font-medium block mb-1">
                      Space Name
                    </label>
                    <input
                      id="calibrate-space-name-input"
                      type="text"
                      value={editSpaceName}
                      onChange={(e) => setEditSpaceName(e.target.value)}
                      className="w-full bg-emerald-950/80 border border-amber-700/60 text-emerald-100 text-xs rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-amber-400"
                      placeholder="e.g. Sunny Living Room Window"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-amber-200 font-medium block mb-1">
                      Space Classification
                    </label>
                    <select
                      id="calibrate-space-type-select"
                      value={editSpaceType}
                      onChange={(e) => setEditSpaceType(e.target.value as any)}
                      className="w-full bg-emerald-950/80 border border-amber-700/60 text-emerald-100 text-xs rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-amber-400"
                    >
                      <option value="indoor_room">Indoor Living Room / Bedroom / Office</option>
                      <option value="window_nook">Indoor Window Sill Nook</option>
                      <option value="balcony">Outdoor Balcony / Railing</option>
                      <option value="patio">Outdoor Patio / Courtyard</option>
                      <option value="terrace">Rooftop / Terrace</option>
                    </select>
                  </div>
                </div>

                {/* Section 2: Dimensional Sliders & Number Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-amber-200">
                      <span className="font-medium">Length / Width (ft)</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.5"
                          min="3"
                          max="40"
                          value={editLength}
                          onChange={(e) => setEditLength(parseFloat(e.target.value) || 3)}
                          className="w-16 px-1.5 py-0.5 rounded bg-emerald-950 border border-amber-700/50 text-white font-mono font-bold text-center text-xs"
                        />
                        <span className="text-[11px] text-amber-300/80">ft</span>
                      </div>
                    </div>
                    <input
                      id="calibrate-length-slider"
                      type="range"
                      min="3"
                      max="35"
                      step="0.5"
                      value={editLength}
                      onChange={(e) => setEditLength(parseFloat(e.target.value))}
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-amber-200">
                      <span className="font-medium">Depth / Breadth (ft)</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.5"
                          min="2"
                          max="30"
                          value={editWidth}
                          onChange={(e) => setEditWidth(parseFloat(e.target.value) || 2)}
                          className="w-16 px-1.5 py-0.5 rounded bg-emerald-950 border border-amber-700/50 text-white font-mono font-bold text-center text-xs"
                        />
                        <span className="text-[11px] text-amber-300/80">ft</span>
                      </div>
                    </div>
                    <input
                      id="calibrate-width-slider"
                      type="range"
                      min="2"
                      max="25"
                      step="0.5"
                      value={editWidth}
                      onChange={(e) => setEditWidth(parseFloat(e.target.value))}
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                  </div>
                </div>

                {/* Live Computed Metrics Strip */}
                <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-amber-900/30 border border-amber-800/50 text-center">
                  <div>
                    <span className="text-[10px] text-amber-300/80 block uppercase tracking-wider">Usable Area</span>
                    <span className="text-sm font-mono font-bold text-white">
                      {Math.round(editLength * editWidth * 0.75 * 10) / 10} sq.ft
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-amber-300/80 block uppercase tracking-wider">Plant Capacity</span>
                    <span className="text-sm font-mono font-bold text-amber-300">
                      {Math.max(2, Math.round((editLength * editWidth * 0.75) / 3.5))} plants
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-amber-300/80 block uppercase tracking-wider">Light Exposure</span>
                    <select
                      value={editLighting}
                      onChange={(e) => setEditLighting(e.target.value)}
                      className="bg-transparent text-xs font-semibold text-white outline-none cursor-pointer text-center"
                    >
                      <option value="BRIGHT_INDIRECT" className="bg-emerald-950 text-white">Bright Indirect</option>
                      <option value="DIRECT" className="bg-emerald-950 text-white">Direct Sun</option>
                      <option value="MEDIUM" className="bg-emerald-950 text-white">Medium Filtered</option>
                      <option value="LOW" className="bg-emerald-950 text-white">Low Light</option>
                    </select>
                  </div>
                </div>

                {/* Section 3: Fine-Tune Detected Zones */}
                {editingZones.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <label className="text-xs text-amber-200 font-medium block">
                      Fine-Tune Detected Green Zones ({editingZones.length})
                    </label>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {editingZones.map((zone, idx) => (
                        <div
                          key={zone.id || idx}
                          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-800/60 text-xs"
                        >
                          <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
                            <span
                              className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/40"
                              style={{ backgroundColor: zone.color || '#10b981' }}
                            />
                            <input
                              type="text"
                              value={zone.name}
                              onChange={(e) => {
                                const updated = [...editingZones];
                                updated[idx] = { ...updated[idx], name: e.target.value };
                                setEditingZones(updated);
                              }}
                              className="bg-transparent text-emerald-100 font-medium text-xs border-b border-dashed border-emerald-700 focus:border-amber-400 outline-none w-full sm:w-48"
                            />
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-auto">
                            <select
                              value={zone.lightLevel}
                              onChange={(e) => {
                                const updated = [...editingZones];
                                updated[idx] = { ...updated[idx], lightLevel: e.target.value as any };
                                setEditingZones(updated);
                              }}
                              className="bg-emerald-900 border border-emerald-700/60 text-emerald-200 text-[11px] rounded-lg px-2 py-1 outline-none"
                            >
                              <option value="direct_sun">Direct Sun</option>
                              <option value="bright_indirect">Bright Indirect</option>
                              <option value="medium_indirect">Medium Indirect</option>
                              <option value="low_light">Low Light</option>
                            </select>

                            <select
                              value={zone.recommendedSize || 'medium'}
                              onChange={(e) => {
                                const updated = [...editingZones];
                                updated[idx] = { ...updated[idx], recommendedSize: e.target.value as any };
                                setEditingZones(updated);
                              }}
                              className="bg-emerald-900 border border-emerald-700/60 text-emerald-200 text-[11px] rounded-lg px-2 py-1 outline-none"
                            >
                              <option value="small">Small Pot</option>
                              <option value="medium">Medium Pot</option>
                              <option value="large">Large Pot</option>
                              <option value="hanging">Hanging</option>
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-amber-900/60">
                  <button
                    type="button"
                    onClick={() => setIsCalibrating(false)}
                    className="px-3.5 py-2 rounded-xl text-xs text-amber-200 hover:text-white cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    id="save-calibration-btn"
                    onClick={handleSaveCalibration}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-amber-950 font-bold text-xs shadow-md cursor-pointer transition-all"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Confirm Corrected Dimensions & Space</span>
                  </button>
                </div>
              </div>
            )}

            {/* Interactive 2D Canvas Container */}
            <div className="relative w-full aspect-[4/3] rounded-2xl bg-emerald-950 border-2 border-emerald-700/60 overflow-hidden shadow-inner p-3 sm:p-4 flex flex-col justify-between">
              {/* Background: Photo Spatial Overlay vs Blueprint Grid */}
              {mapViewMode === 'photo_overlay' && (selectedImage || activeSpace.photoUrl) ? (
                <div className="absolute inset-0 z-0">
                  <img
                    src={selectedImage || activeSpace.photoUrl}
                    alt="Uploaded Space Layout"
                    className="w-full h-full object-cover object-center filter brightness-[0.72] contrast-[1.05]"
                  />
                  <div className="absolute inset-0 bg-emerald-950/20 backdrop-blur-[0.5px]" />
                </div>
              ) : (
                <div
                  className="absolute inset-0 opacity-15 pointer-events-none"
                  style={{
                    backgroundImage:
                      'radial-gradient(circle, #34d399 1px, transparent 1px), radial-gradient(circle, #34d399 1px, transparent 1px)',
                    backgroundSize: '20px 20px',
                  }}
                />
              )}

              {/* Sunlight Orientation Indicator */}
              <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/80 backdrop-blur-sm border border-emerald-700/60 text-amber-300 text-[11px] font-semibold shadow-md">
                <Sun className="w-3.5 h-3.5 text-amber-400 animate-spin-slow" />
                <span>
                  {analysis?.lightType ? `${analysis.lightType} Light Vector` : 'Natural Sunlight Vector'}
                </span>
              </div>

              {/* Active Space Type Badge */}
              <div className="absolute top-3 left-3 z-20 flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-950/80 backdrop-blur-sm border border-emerald-700/60 text-emerald-200 text-[10px] font-mono uppercase font-bold tracking-wider">
                <span>{activeSpace.spaceType?.replace('_', ' ')}</span>
                <span className="text-emerald-400">•</span>
                <span>{activeSpace.zones?.length || 0} Zones</span>
              </div>

              {/* Rendered Zones Mapped to Photo Layout */}
              <div className="relative w-full h-full z-10">
                {activeSpace.zones?.map((zone) => {
                  const isSelected = selectedZone?.id === zone.id;
                  const isPlantZone = zone.zoneType === 'plant_zone';
                  const isWalkway = zone.zoneType === 'walkway';

                  return (
                    <div
                      key={zone.id}
                      id={`map-zone-${zone.id}`}
                      onClick={() => setSelectedZone(zone)}
                      style={{
                        left: `${zone.x}%`,
                        top: `${zone.y}%`,
                        width: `${zone.w}%`,
                        height: `${zone.h}%`,
                      }}
                      className={`absolute rounded-xl transition-all cursor-pointer p-2 flex flex-col justify-between select-none ${
                        isSelected
                          ? 'ring-2 ring-white scale-[1.02] z-30 shadow-2xl backdrop-blur-sm'
                          : 'hover:scale-[1.01] z-10 hover:z-20'
                      } ${
                        isPlantZone
                          ? zone.lightLevel === 'direct_sun'
                            ? 'bg-amber-500/35 border-2 border-amber-400 text-amber-100 shadow-amber-950/50'
                            : 'bg-emerald-500/35 border-2 border-emerald-400 text-emerald-100 shadow-emerald-950/50'
                          : isWalkway
                          ? 'bg-slate-800/45 border-2 border-dashed border-slate-400 text-slate-200'
                          : 'bg-stone-800/50 border-2 border-stone-400 text-stone-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-[11px] font-bold truncate drop-shadow">{zone.name}</span>
                        {isPlantZone && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/60 text-emerald-300 font-mono shrink-0">
                            {zone.lightLevel === 'direct_sun' ? '☀️ High Sun' : '🌤️ Bright'}
                          </span>
                        )}
                        {isWalkway && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/60 text-slate-300 font-mono shrink-0">
                            🚶 Path
                          </span>
                        )}
                      </div>

                      {/* Zone info & micro-notes */}
                      <div className="flex flex-col gap-0.5 text-[10px]">
                        {isPlantZone && (
                          <div className="flex items-center gap-1 font-medium drop-shadow">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="truncate">Rec: {zone.recommendedSize || 'Medium'} Plant</span>
                          </div>
                        )}
                        {zone.notes && (
                          <span className="text-[9px] text-white/80 line-clamp-1 italic drop-shadow">
                            {zone.notes}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Map Footer Legend */}
              <div className="z-20 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-emerald-800/60 bg-emerald-950/85 backdrop-blur-sm -mx-3 -mb-3 sm:-mx-4 sm:-mb-4 px-3 py-2 text-[11px] text-emerald-300/90 rounded-b-2xl">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-amber-500/60 border border-amber-400" />
                    <span>High Sun Zone</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-emerald-500/60 border border-emerald-400" />
                    <span>Medium/Bright Zone</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-slate-700/60 border border-dashed border-slate-400" />
                    <span>Clearance Walkway</span>
                  </div>
                </div>
                <span className="font-mono text-emerald-400 font-semibold text-xs">
                  Utilization: {activeSpace.currentUtilizationPct || 0}%
                </span>
              </div>
            </div>

            {/* Selected Zone Inspector */}
            {selectedZone && (
              <div className="p-4 rounded-xl bg-emerald-900/50 border border-emerald-700/60 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm">{selectedZone.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-800 text-emerald-300 uppercase font-mono">
                        {selectedZone.zoneType.replace('_', ' ')}
                      </span>
                      {selectedZone.lightLevel && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-900/80 text-amber-300 font-mono">
                          {selectedZone.lightLevel.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-emerald-200/90 leading-relaxed">
                      {selectedZone.notes || 'Identified functional green zone mapped directly from your space photo.'}
                    </p>
                  </div>

                  {selectedZone.zoneType === 'plant_zone' && (
                    <button
                      type="button"
                      id="find-plants-for-zone-btn"
                      onClick={() => setActiveTab('plants')}
                      className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold text-xs shadow transition-colors whitespace-nowrap cursor-pointer shrink-0"
                    >
                      <span>Match Plants for this Zone</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Micro-Recommendation for Selected Zone */}
                {selectedZone.zoneType === 'plant_zone' && analysis?.plantRecommendations && (
                  <div className="pt-2 border-t border-emerald-800/40 flex items-center gap-2 text-xs text-emerald-300">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="font-medium">Compatible species:</span>
                    <span className="text-white font-semibold truncate">
                      {analysis.plantRecommendations.slice(0, 3).map((p) => p.name).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

