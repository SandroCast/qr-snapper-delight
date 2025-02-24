
import React, { useEffect, useState, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { Camera, CameraResultType } from '@capacitor/camera';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const QRScanner = () => {
  const [targetQRCode, setTargetQRCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const takePicture = async () => {
    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Base64
      });

      if (image.base64String) {
        const fileName = `qr-snap-${Date.now()}.jpeg`;
        await Filesystem.writeFile({
          path: fileName,
          data: image.base64String,
          directory: Directory.Documents
        });

        setPhotoCount(prev => prev + 1);
        toast.success('Foto capturada e salva!');
      }
    } catch (error) {
      console.error('Erro ao capturar foto:', error);
      toast.error('Erro ao capturar foto');
    }
  };

  const startScanning = () => {
    if (!targetQRCode.trim()) {
      toast.error('Por favor, insira um texto para buscar no QR Code');
      return;
    }

    setIsScanning(true);
    scannerRef.current = new Html5QrcodeScanner(
      "qr-reader",
      { fps: 10, qrbox: 250 },
      false
    );

    scannerRef.current.render(onScanSuccess, onScanError);
  };

  const onScanSuccess = async (decodedText: string) => {
    if (decodedText === targetQRCode && scannerRef.current) {
      scannerRef.current.pause(true);
      
      await takePicture();
      
      // Aguarda 10 segundos antes de reiniciar o scanner
      timeoutRef.current = setTimeout(() => {
        if (scannerRef.current) {
          scannerRef.current.resume();
        }
      }, 10000);
    }
  };

  const onScanError = (error: any) => {
    // Erros de scan são comuns e esperados, então não precisamos fazer nada aqui
  };

  const stopScanning = () => {
    if (scannerRef.current) {
      scannerRef.current.clear();
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsScanning(false);
  };

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

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

          {isScanning && (
            <div id="qr-reader" className="w-full">
              {/* O scanner QR será renderizado aqui */}
            </div>
          )}

          <div className="text-center text-sm text-gray-500">
            Fotos capturadas: {photoCount}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRScanner;
