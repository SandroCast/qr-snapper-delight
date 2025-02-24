import React, { useEffect, useState, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Download } from "lucide-react";

const QRScanner = () => {
  const [targetQRCode, setTargetQRCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const processingRef = useRef<boolean>(false);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  const turnOnFlash = async () => {
    try {
      const track = trackRef.current;
      if (track) {
        const imageCapture = new ImageCapture(track);
        const photoCapabilities = await imageCapture.getPhotoCapabilities();
        
        if (photoCapabilities?.fillLightMode?.includes('flash')) {
          await track.applyConstraints({
            advanced: [{ torch: true }]
          });
        }
      }
    } catch (error) {
      console.error('Erro ao ligar o flash:', error);
    }
  };

  const turnOffFlash = async () => {
    try {
      const track = trackRef.current;
      if (track) {
        await track.applyConstraints({
          advanced: [{ torch: false }]
        });
      }
    } catch (error) {
      console.error('Erro ao desligar o flash:', error);
    }
  };

  const captureFrame = async () => {
    try {
      const qrElement = document.querySelector('#qr-reader video') as HTMLVideoElement;
      if (!qrElement) {
        throw new Error('Video element not found');
      }

      await turnOnFlash();
      
      await new Promise(resolve => setTimeout(resolve, 500));

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
        directory: Directory.Documents
      });

      await new Promise(resolve => setTimeout(resolve, 500));
      await turnOffFlash();

      setPhotos(prev => [...prev, fileName]);
      setPhotoCount(prev => prev + 1);
      toast.success('Foto capturada e salva!');
    } catch (error) {
      console.error('Erro ao capturar foto:', error);
      toast.error('Erro ao capturar foto');
      await turnOffFlash();
    }
  };

  const downloadAllPhotos = async () => {
    try {
      const downloadPhoto = async (fileName: string, index: number) => {
        try {
          const file = await Filesystem.readFile({
            path: fileName,
            directory: Directory.Documents
          });

          const link = document.createElement('a');
          link.href = `data:image/jpeg;base64,${file.data}`;
          link.download = fileName;
          document.body.appendChild(link);
          
          await new Promise(resolve => setTimeout(resolve, index * 1000));
          
          link.click();
          document.body.removeChild(link);
          
          toast.success(`Foto ${index + 1} baixada com sucesso!`);
        } catch (error) {
          console.error(`Erro ao baixar foto ${fileName}:`, error);
          toast.error(`Erro ao baixar foto ${index + 1}`);
        }
      };

      await photos.reduce(async (promise, fileName, index) => {
        await promise;
        await downloadPhoto(fileName, index);
      }, Promise.resolve());

      toast.success('Download de todas as fotos concluído!');
    } catch (error) {
      console.error('Erro ao baixar fotos:', error);
      toast.error('Erro ao baixar fotos');
    }
  };

  const startScanning = async () => {
    if (!targetQRCode.trim()) {
      toast.error('Por favor, insira um texto para buscar no QR Code');
      return;
    }

    try {
      const constraints = {
        video: {
          facingMode: 'environment',
          advanced: [{
            torch: false
          }]
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const videoTrack = stream.getVideoTracks()[0];
      trackRef.current = videoTrack;
      
      setIsScanning(true);
    } catch (error) {
      console.error('Erro ao iniciar câmera:', error);
      setIsScanning(true);
    }
  };

  const stopScanning = async () => {
    if (trackRef.current) {
      await turnOffFlash();
      trackRef.current = null;
    }
    
    if (scannerRef.current) {
      scannerRef.current.clear();
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsScanning(false);
    processingRef.current = false;
  };

  const onScanSuccess = async (decodedText: string) => {
    if (decodedText === targetQRCode && scannerRef.current && !processingRef.current) {
      processingRef.current = true;
      
      try {
        await scannerRef.current.pause();
        await captureFrame();
        
        timeoutRef.current = setTimeout(async () => {
          if (scannerRef.current) {
            try {
              await scannerRef.current.resume();
              processingRef.current = false;
            } catch (error) {
              console.error('Erro ao resumir scanner:', error);
              processingRef.current = false;
            }
          }
        }, 10000);
      } catch (error) {
        console.error('Erro no processo de captura:', error);
        processingRef.current = false;
      }
    }
  };

  const onScanError = (error: any) => {
    // Erros de scan são comuns e esperados, então não precisamos fazer nada aqui
  };

  useEffect(() => {
    if (isScanning && !scannerRef.current) {
      scannerRef.current = new Html5QrcodeScanner(
        "qr-reader",
        { fps: 10, qrbox: 250 },
        false
      );
      scannerRef.current.render(onScanSuccess, onScanError);
    }

    return () => {
      stopScanning();
    };
  }, [isScanning, targetQRCode]);

  return (
    <div className="min-h-screen p-6 bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="max-w-md mx-auto space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tighter">QR Snapper</h1>
          <p className="text-gray-500">Captura automática de fotos por QR Code</p>
        </div>

        <div className="p-6 bg-white rounded-lg shadow-lg space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Texto do QR Code</label>
            <Input
              type="text"
              placeholder="Digite o texto do QR Code"
              value={targetQRCode}
              onChange={(e) => setTargetQRCode(e.target.value)}
              disabled={isScanning}
              className="w-full"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex justify-center">
              {!isScanning ? (
                <Button
                  onClick={startScanning}
                  className="w-full bg-green-500 hover:bg-green-600 text-white"
                >
                  Iniciar Scanner
                </Button>
              ) : (
                <Button
                  onClick={stopScanning}
                  className="w-full bg-red-500 hover:bg-red-600 text-white"
                >
                  Parar Scanner
                </Button>
              )}
            </div>

            {photoCount > 0 && (
              <Button
                onClick={downloadAllPhotos}
                className="w-full flex items-center justify-center gap-2"
                variant="outline"
              >
                <Download size={16} />
                Baixar {photoCount} foto{photoCount !== 1 ? 's' : ''}
              </Button>
            )}
          </div>

          <div id="qr-reader" className={`w-full ${!isScanning ? 'hidden' : ''}`}>
            {/* O scanner QR será renderizado aqui */}
          </div>

          <div className="text-center text-sm text-gray-500">
            Fotos capturadas: {photoCount}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRScanner;
