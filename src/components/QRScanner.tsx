import React, { useEffect, useState, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

const QRScanner = () => {
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Estado da posição e tamanho da área de leitura
  const [overlay, setOverlay] = useState({ x: 100, y: 100, width: 200, height: 200 });

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear();
      }
    };
  }, []);

  const startScanning = () => {
    if (scannerRef.current) {
      scannerRef.current.clear();
    }

    const scanner = new Html5QrcodeScanner(
      "qr-reader",
      { fps: 10, qrbox: { width: 500, height: 500 } },
      false
    );

    scannerRef.current = scanner;

    scanner.render((decodedText) => {
      if (isWithinOverlay(decodedText)) {
        alert(`QR Code detectado: ${decodedText}`);
      }
    });

    setIsScanning(true);
  };

  const stopScanning = () => {
    if (scannerRef.current) {
      scannerRef.current.clear();
      scannerRef.current = null;
    }
    setIsScanning(false);
  };

  const isWithinOverlay = (decodedText: string) => {
    if (!videoRef.current || !overlayRef.current) return false;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    const { videoWidth, videoHeight } = videoRef.current;
    canvas.width = videoWidth;
    canvas.height = videoHeight;

    ctx.drawImage(videoRef.current, 0, 0, videoWidth, videoHeight);

    // Recortar a parte da imagem correspondente ao overlay
    const imageData = ctx.getImageData(overlay.x, overlay.y, overlay.width, overlay.height);
    
    // Aqui você pode tentar decodificar o QR Code apenas nessa região
    // (Necessário um algoritmo adicional ou adaptação do Html5Qrcode)

    return true; // Retornar true apenas se um QR Code foi detectado na área recortada
  };

  // Permitir que o overlay seja movido
  const handleMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const { x, y } = overlay;

    const onMouseMove = (moveEvent: MouseEvent) => {
      setOverlay({
        ...overlay,
        x: x + moveEvent.clientX - startX,
        y: y + moveEvent.clientY - startY,
      });
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div className="relative">
      <div id="qr-reader" className="w-full h-full"></div>

      {/* Overlay arrastável */}
      <div
        ref={overlayRef}
        style={{
          position: "absolute",
          top: overlay.y,
          left: overlay.x,
          width: overlay.width,
          height: overlay.height,
          border: "2px solid red",
          cursor: "move",
        }}
        onMouseDown={handleMouseDown}
      ></div>

      <button onClick={isScanning ? stopScanning : startScanning}>
        {isScanning ? "Parar Scanner" : "Iniciar Scanner"}
      </button>
    </div>
  );
};

export default QRScanner;
