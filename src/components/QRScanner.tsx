import React, { useEffect, useState, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Camera, Download } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import JSZip from 'jszip';

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
  
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const processingRef = useRef<boolean>(false);
  const imageCaptureRef = useRef<CustomImageCapture | null>(null);
  const cooldownIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    loadCameras();
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
        // Try the standard way first
        await track.applyConstraints({
          advanced: [{ torch: true }] as any
        });
      } catch (e) {
        console.log('Standard torch failed, trying alternative method');
        // Try alternative method
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

      const qrElement = document.querySelector('#qr-reader video') as HTMLVideoElement;
      if (!qrElement) {
        throw new Error('Video element not found');
      }

      if (useFlash) {
        await turnOnFlash();
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 segundos para estabilizar
      }

      const canvas = document.createElement('canvas');
      canvas.width = qrElement.videoWidth;
      canvas.height = qrElement.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      ctx.drawImage(qrElement, 0, 0, canvas.width, canvas.height);

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

      const scanner = new Html5QrcodeScanner(
        "qr-reader",
        { 
          fps: 10,
          videoConstraints: {
            deviceId: selectedCamera,
            facingMode: "environment",
            width: { ideal: 1920 },  // Define um valor ideal para a largura
            height: { ideal: 1080 }  // Define um valor ideal para a altura
          }
        },
        false
      );

      scannerRef.current = scanner;

      scanner.render((decodedText) => {
        if (processingRef.current || isCooldown) return;

        if (decodedText === targetQRCode) {
          processingRef.current = true;
          captureFrame().finally(() => {
            processingRef.current = false;
          });
        }
      }, (error) => {
        console.log(error);
      });

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

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="space-y-6">
          <div className="aspect-[4/3] bg-gray-200 rounded-lg overflow-hidden">
            <div id="qr-reader" className="w-full h-full"></div>
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
                    <SelectItem key={camera.deviceId} value={camera.deviceId}>
                      {camera.label || `Câmera ${camera.deviceId.slice(0, 5)}`}
                    </SelectItem>
                  ))}
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
              onClick={startScanning}
              disabled={isScanning}
            >
              <Camera className="mr-2 h-4 w-4" />
              {isScanning ? 'Scanner Ativo' : 'Iniciar Scanner'}
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRScanner;
