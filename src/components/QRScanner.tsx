import React, { useEffect, useState, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Download, Camera } from "lucide-react";

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
      if (track && 'applyConstraints' in track) {
        await track.applyConstraints({
          advanced: [{ fillLight: 'flash' }] as any
        });
      }
    } catch (error) {
      console.error('Erro ao ligar o flash:', error);
    }
  };

  const turnOffFlash = async () => {
    try {
      const track = trackRef.current;
      if (track && 'applyConstraints' in track) {
        await track.applyConstraints({
          advanced: [{ fillLight: 'none' }] as any
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

  const startScanning = async () => {
    if (!targetQRCode.trim()) {
      toast.error('Por favor, insira um texto para buscar no QR Code');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment'
        }
      });
      
      const videoTrack = stream.getVideoTracks()[0];
      trackRef.current = videoTrack;
      
      setIsScanning(true);
    } catch (error) {
      console.error('Erro ao iniciar câmera:', error);
      setIsScanning(true);
    }
  };

  useEffect(() => {
    let html5QrcodeScanner: Html5QrcodeScanner | null = null;

    const initializeScanner = () => {
      html5QrcodeScanner = new Html5QrcodeScanner(
        "qr-reader",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        false
      );

      scannerRef.current = html5QrcodeScanner;

      html5QrcodeScanner.render(
        (decodedText: string) => {
          if (processingRef.current) {
            return;
          }

          if (decodedText.includes(targetQRCode)) {
            processingRef.current = true;
            captureFrame()
              .then(() => {
                processingRef.current = false;
                if (timeoutRef.current) {
                  clearTimeout(timeoutRef.current);
                }
                timeoutRef.current = setTimeout(() => {
                  if (html5QrcodeScanner) {
                    html5QrcodeScanner.resume();
                  }
                }, 2000);
              })
              .catch(() => {
                processingRef.current = false;
              });
            html5QrcodeScanner.pause(true);
          }
        },
        (errorMessage: string) => {
          console.log(`QR code scan failed: ${errorMessage}`);
        }
      );
    };

    if (isScanning) {
      initializeScanner();
    }

    return () => {
      if (html5QrcodeScanner) {
        html5QrcodeScanner.clear();
      }
    };
  }, [isScanning, targetQRCode]);

  const downloadPhotos = async () => {
    try {
      if (photos.length === 0) {
        toast.error('Nenhuma foto para baixar.');
        return;
      }

      const zip = require('jszip')();
      for (const photo of photos) {
        const file = await Filesystem.readFile({
          path: photo,
          directory: Directory.Documents,
          encoding: 'base64'
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
      toast.error('Erro ao baixar fotos.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="space-y-6">
          {/* Área do preview da câmera */}
          <div className="aspect-[4/3] bg-gray-200 rounded-lg overflow-hidden">
            <div id="qr-reader" className="w-full h-full"></div>
          </div>
          
          {/* Input para o número */}
          <div className="space-y-2">
            <Input
              type="text"
              placeholder="Digite o número do código QR"
              className="w-full border-2 border-gray-300"
              value={targetQRCode}
              onChange={(e) => setTargetQRCode(e.target.value)}
            />
          </div>

          {/* Botões de ação */}
          <div className="space-y-3">
            <Button 
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg flex items-center justify-center gap-2"
              onClick={startScanning}
              disabled={isScanning}
            >
              <Camera className="w-5 h-5" />
              {isScanning ? 'Scanner Ligado' : 'Iniciar Scanner'}
            </Button>
            
            <Button 
              variant="outline"
              className="w-full border-2 border-gray-300 py-3 rounded-lg"
              onClick={downloadPhotos}
            >
              <Download className="w-5 h-5" />
              Download Fotos
            </Button>
          </div>

          {/* Contador de fotos */}
          <div className="text-center text-gray-600">
            Fotos capturadas: {photoCount}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRScanner;
