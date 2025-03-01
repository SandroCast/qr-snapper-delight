import React, { useEffect, useState, useRef } from 'react';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Camera, Download, Video } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import JSZip from 'jszip';

async function preventScreenLock() {
  if ("wakeLock" in navigator) {
    try {
      let wakeLock = await navigator.wakeLock.request("screen");
      console.log("Wake Lock ativado!");

      document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState === "visible") {
          try {
            wakeLock = await navigator.wakeLock.request("screen");
            console.log("Wake Lock reativado!");
          } catch (err) {
            console.error("Erro ao reativar Wake Lock:", err);
          }
        }
      });
    } catch (err) {
      console.error("Wake Lock falhou:", err);
    }
  } else {
    console.warn("Wake Lock API não suportada no navegador.");
  }
}

interface CustomImageCapture {
  track: MediaStreamTrack;
  setTorch: (enabled: boolean) => Promise<void>;
}

const QRScanner = () => {
  const [targetQRCode, setTargetQRCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]);
  const [useFlash, setUseFlash] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [cooldownProgress, setCooldownProgress] = useState(100);
  const [isCooldown, setIsCooldown] = useState(false);
  const [generatingTimelapse, setGeneratingTimelapse] = useState(false);
  const [timelapseSpeed, setTimelapseSpeed] = useState(1);

  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const processingRef = useRef<boolean>(false);
  const imageCaptureRef = useRef<CustomImageCapture | null>(null);
  const cooldownIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    loadCameras();
    preventScreenLock();
    
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      #qr-reader {
        position: relative !important;
        width: 150px !important;
        height: 150px !important;
        overflow: hidden !important;
        position: absolute !important;
        top: 10px !important;
        right: 10px !important;
        z-index: 100 !important;
        border: 2px solid #0070f3 !important;
        border-radius: 8px !important;
      }
      
      #qr-reader video {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
      }
      
      #qr-reader__dashboard_section_csr {
        display: none !important;
      }
      
      #qr-reader__dashboard {
        display: none !important;
      }
      
      #qr-reader__status_span {
        display: none !important;
      }
      
      #qr-reader__dashboard_section_swaplink {
        display: none !important;
      }
      
      #qr-reader__camera_selection {
        display: none !important;
      }
      
      #qr-reader__scan_region {
        border: none !important;
      }

      #preview-container {
        position: relative !important;
        width: 100% !important;
        height: 300px !important;
        border-radius: 8px !important;
        overflow: hidden !important;
        background-color: #fff !important;
      }
      
      #preview-video {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
      }
      
      /* Overlay para mostrar a área de detecção do QR code (20% direita) */
      #scan-region-highlight {
        position: absolute;
        top: 0;
        right: 0;
        width: 20%;
        height: 100%;
        border: 2px dashed #0070f3;
        box-sizing: border-box;
        pointer-events: none;
        z-index: 50;
        background-color: rgba(0, 112, 243, 0.1);
      }
      
      /* Escurecendo o restante da tela */
      #scan-region-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 80%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        pointer-events: none;
        z-index: 49;
      }
    `;
    document.head.appendChild(styleElement);
    
    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear();
      }
      if (cooldownIntervalRef.current) {
        window.clearInterval(cooldownIntervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (isScanning && useFlash) {
      turnOnFlash();
    } else if (!useFlash) {
      turnOffFlash();
    }
  }, [useFlash, isScanning]);

  const turnOnFlash = async () => {
    try {
      const videoElement = document.querySelector('#qr-reader video') as HTMLVideoElement;
      if (!videoElement?.srcObject) {
        console.log('No video source found');
        return;
      }

      const stream = videoElement.srcObject as MediaStream;
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      
      if (!track) {
        console.log('No video track found');
        return;
      }

      console.log('Attempting to turn on flash');
      
      try {
        await track.applyConstraints({
          advanced: [{ torch: true }] as any
        });
      } catch (e) {
        console.log('Standard torch failed, trying alternative method');
        await track.applyConstraints({
          advanced: [{ fillLightMode: 'flash' }] as any
        });
      }
      
      console.log('Flash settings applied');
    } catch (error) {
      console.error('Error turning on flash:', error);
      toast.error('Não foi possível ativar a lanterna');
    }
  };

  const turnOffFlash = async () => {
    try {
      if (streamRef.current) {
        const track = streamRef.current.getVideoTracks()[0];
        if (track) {
          await track.applyConstraints({
            advanced: [{ torch: false }] as any
          });
        }
      }
    } catch (error) {
      console.error('Error turning off flash:', error);
    }
  };

  const loadCameras = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      setCameras(videoDevices);
      if (videoDevices.length > 0) {
        setSelectedCamera(videoDevices[0].deviceId);
      }
    } catch (error) {
      console.error('Erro ao carregar câmeras:', error);
      toast.error('Erro ao carregar câmeras disponíveis');
    }
  };

  const stopScanning = () => {
    if (scannerRef.current) {
      scannerRef.current.clear();
      scannerRef.current = null;
    }
    setIsScanning(false);
  };

  const startCooldown = () => {
    setIsCooldown(true);
    setCooldownProgress(0);
    let progress = 0;
    
    stopScanning();
    
    if (cooldownIntervalRef.current) {
      window.clearInterval(cooldownIntervalRef.current);
    }
    
    cooldownIntervalRef.current = window.setInterval(() => {
      progress += 1;
      setCooldownProgress(progress);
      
      if (progress >= 100) {
        setIsCooldown(false);
        if (cooldownIntervalRef.current) {
          window.clearInterval(cooldownIntervalRef.current);
        }
        startScanning();
      }
    }, 100); // Updates every 100ms for smooth progress
  };

  const captureFrame = async () => {
    try {
      if (isCooldown) {
        toast.error('Aguarde o tempo de espera para capturar novamente');
        return;
      }

      let videoElement = document.getElementById('preview-video') as HTMLVideoElement;
      if (!videoElement || !videoElement.srcObject) {
        console.error('Preview video element not found or no source');
        const qrElement = document.querySelector('#qr-reader video') as HTMLVideoElement;
        if (!qrElement || !qrElement.srcObject) {
          throw new Error('No video source found for capture');
        }
        videoElement = qrElement;
      }

      if (useFlash) {
        await turnOnFlash();
        await new Promise(resolve => setTimeout(resolve, 500)); // Short delay for flash to stabilize
      }

      const canvas = document.createElement('canvas');
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

      const base64Image = canvas.toDataURL('image/jpeg', 0.9);
      const base64Data = base64Image.split(',')[1];

      const fileName = `qr-snap-${Date.now()}.jpeg`;
      await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Documents,
        encoding: Encoding.UTF8
      });

      setPhotos(prev => [...prev, fileName]);
      setPhotoCount(prev => prev + 1);
      toast.success('Foto capturada e salva!');

      if (useFlash) {
        await turnOffFlash();
      }
      
      startCooldown();
      
    } catch (error) {
      console.error('Erro ao capturar foto:', error);
      toast.error('Erro ao capturar foto');
      if (useFlash) await turnOffFlash();
    }
  };

  const startScanning = async () => {
    if (!targetQRCode.trim()) {
      toast.error('Por favor, insira um texto para buscar no QR Code');
      return;
    }

    try {
      if (isCooldown) {
        toast.error('Aguarde o fim do período de espera');
        return;
      }

      if (scannerRef.current) {
        scannerRef.current.clear();
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }

      const initialQRBoxWidth = 120;
      const initialQRBoxHeight = 120;
      
      const scanner = new Html5QrcodeScanner(
        "qr-reader",
        { 
          fps: 10,
          qrbox: { 
            width: initialQRBoxWidth, 
            height: initialQRBoxHeight 
          },
          videoConstraints: {
            deviceId: selectedCamera,
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
        },
        false
      );

      scannerRef.current = scanner;

      const setupVideoTimer = setInterval(() => {
        console.log('Checking for video elements');
        const videoElement = document.querySelector('#qr-reader video') as HTMLVideoElement;
        if (videoElement && videoElement.srcObject) {
          clearInterval(setupVideoTimer);
          console.log('QR scanner video found, setting up preview');
          
          videoRef.current = videoElement;
          
          const stream = videoElement.srcObject as MediaStream;
          streamRef.current = stream;
          
          const previewStream = new MediaStream();
          stream.getVideoTracks().forEach(track => {
            previewStream.addTrack(track.clone());
          });
          
          const previewVideo = document.getElementById('preview-video') as HTMLVideoElement;
          if (previewVideo) {
            previewVideo.srcObject = previewStream;
            previewVideo.play().catch(e => {
              console.error('Error starting preview:', e);
              previewVideo.srcObject = stream;
              previewVideo.play().catch(e2 => console.error('Fallback also failed:', e2));
            });
            
            const previewContainer = document.getElementById('preview-container');
            
            const existingOverlay = document.getElementById('scan-region-overlay');
            if (existingOverlay) existingOverlay.remove();
            
            const existingHighlight = document.getElementById('scan-region-highlight');
            if (existingHighlight) existingHighlight.remove();
            
            if (previewContainer) {
              const scanRegionOverlay = document.createElement('div');
              scanRegionOverlay.id = 'scan-region-overlay';
              previewContainer.appendChild(scanRegionOverlay);
              
              const scanRegionHighlight = document.createElement('div');
              scanRegionHighlight.id = 'scan-region-highlight';
              previewContainer.appendChild(scanRegionHighlight);
            }
            
            const originalSuccess = scanner.getStateManager().onSuccessCallback;
            
            scanner.getStateManager().onSuccessCallback = (decodedText, decodedResult) => {
              if (decodedText === targetQRCode && !processingRef.current && !isCooldown) {
                processingRef.current = true;
                captureFrame().finally(() => {
                  processingRef.current = false;
                });
              }
            };
          }
        }
      }, 500);

      setTimeout(() => {
        clearInterval(setupVideoTimer);
      }, 10000);

      setIsScanning(true);
    } catch (error) {
      console.error('Erro ao iniciar scanner:', error);
      toast.error('Erro ao iniciar scanner');
    }
  };

  const downloadPhotos = async () => {
    try {
      if (photos.length === 0) {
        toast.error('Nenhuma foto para baixar');
        return;
      }

      const zip = new JSZip();
      
      for (const photo of photos) {
        const file = await Filesystem.readFile({
          path: photo,
          directory: Directory.Documents,
          encoding: Encoding.UTF8
        });
        zip.file(photo, file.data, { base64: true });
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qr-snaps.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Fotos baixadas com sucesso!');
    } catch (error) {
      console.error('Erro ao baixar fotos:', error);
      toast.error('Erro ao baixar fotos');
    }
  };

  const createTimelapse = async () => {
    if (photos.length === 0) {
      toast.error('Nenhuma foto disponível para criar o timelapse');
      return;
    }

    try {
      setGeneratingTimelapse(true);
      toast.info('Iniciando geração do timelapse...');

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      const firstImageData = await Filesystem.readFile({
        path: photos[0],
        directory: Directory.Documents,
        encoding: Encoding.UTF8
      });

      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = `data:image/jpeg;base64,${firstImageData.data}`;
      });

      canvas.width = img.width;
      canvas.height = img.height;

      let mimeType = '';
      let fileExtension = '';
      
      if (MediaRecorder.isTypeSupported('video/mp4;codecs=h264')) {
        mimeType = 'video/mp4;codecs=h264';
        fileExtension = 'mp4';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
        mimeType = 'video/webm;codecs=h264';
        fileExtension = 'webm';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        mimeType = 'video/webm;codecs=vp9';
        fileExtension = 'webm';
      } else {
        mimeType = 'video/webm';
        fileExtension = 'webm';
      }

      const stream = canvas.captureStream(30); // 30fps
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 8000000 // 8Mbps para melhor qualidade
      });

      const chunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `timelapse.${fileExtension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setGeneratingTimelapse(false);
        toast.success('Timelapse gerado com sucesso!');
      };

      mediaRecorder.start();

      let frameCount = 0;
      const totalFrames = photos.length;

      for (const photo of photos) {
        const imageData = await Filesystem.readFile({
          path: photo,
          directory: Directory.Documents,
          encoding: Encoding.UTF8
        });

        await new Promise<void>((resolve) => {
          const frameImg = new Image();
          frameImg.onload = () => {
            ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
            
            frameCount++;
            const progress = Math.round((frameCount / totalFrames) * 100);
            toast.info(`Processando frames: ${progress}%`, {
              id: 'timelapse-progress'
            });
            
            resolve();
          };
          frameImg.src = `data:image/jpeg;base64,${imageData.data}`;
        });

        await new Promise(resolve => setTimeout(resolve, 100 / timelapseSpeed));
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      
      mediaRecorder.stop();

    } catch (error) {
      console.error('Erro ao gerar timelapse:', error);
      toast.error('Erro ao gerar timelapse');
      setGeneratingTimelapse(false);
    }
  };

  return (
    <div className="min-h-screen bg-white p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="space-y-6">
          <div className="aspect-[4/3] bg-white rounded-lg overflow-hidden relative" id="preview-container">
            <video id="preview-video" className="w-full h-full" playsInline muted autoPlay></video>
            
            <div id="qr-reader" className="absolute top-2 right-2 w-32 h-32 rounded-lg overflow-hidden"></div>
          </div>
          
          <div className="space-y-2">
            <Input
              type="text"
              placeholder="Digite o texto do QR Code"
              value={targetQRCode}
              onChange={(e) => setTargetQRCode(e.target.value)}
              className="w-full"
            />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Usar lanterna</span>
              <Switch
                checked={useFlash}
                onCheckedChange={setUseFlash}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Selecionar câmera</label>
              <Select value={selectedCamera} onValueChange={setSelectedCamera}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma câmera" />
                </SelectTrigger>
                <SelectContent>
                  {cameras.map((camera) => (
                    <SelectItem key={camera.deviceId} value={camera.deviceId || "default"}>
                      {camera.label || `Câmera ${camera.deviceId.slice(0, 5)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Velocidade do Timelapse</label>
              <Select 
                value={timelapseSpeed.toString()} 
                onValueChange={(value) => setTimelapseSpeed(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a velocidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.5">0.5x (Lento)</SelectItem>
                  <SelectItem value="1">1x (Normal)</SelectItem>
                  <SelectItem value="2">2x (Rápido)</SelectItem>
                  <SelectItem value="4">4x (Muito Rápido)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isCooldown && (
            <div className="space-y-2">
              <div className="text-sm text-center">
                Aguarde {Math.ceil((100 - cooldownProgress) / 10)} segundos
              </div>
              <Progress value={cooldownProgress} className="w-full" />
            </div>
          )}

          <div className="space-y-3">
            <Button 
              className="w-full"
              onClick={isScanning ? stopScanning : startScanning}
            >
              <Camera className="mr-2 h-4 w-4" />
              {isScanning ? 'Parar Scanner' : 'Iniciar Scanner'}
            </Button>
            
            <Button 
              variant="outline"
              className="w-full"
              onClick={downloadPhotos}
              disabled={photos.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              Download Fotos ({photoCount})
            </Button>

            <Button
              variant="outline"
              className="w-full"
              onClick={createTimelapse}
              disabled={photos.length === 0 || generatingTimelapse}
            >
              <Video className="mr-2 h-4 w-4" />
              {generatingTimelapse ? 'Gerando Timelapse...' : 'Criar Timelapse'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRScanner;
