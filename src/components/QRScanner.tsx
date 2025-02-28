
import React, { useEffect, useState, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Camera, Download, Video, Maximize, Minimize, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import JSZip from 'jszip';

async function preventScreenLock() {
  if ("wakeLock" in navigator) {
    try {
      let wakeLock = await navigator.wakeLock.request("screen");
      console.log("Wake Lock ativado!");

      // Se perder o Wake Lock ao minimizar, reativa ao voltar
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
  const [showScanControls, setShowScanControls] = useState(false);
  
  // Região do scanner (em pixels)
  const [scanBox, setScanBox] = useState({
    width: 200,
    height: 200,
    x: 0,
    y: 0
  });
  
  const html5QrcodeRef = useRef<Html5Qrcode | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const processingRef = useRef<boolean>(false);
  const imageCaptureRef = useRef<CustomImageCapture | null>(null);
  const cooldownIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadCameras();
    preventScreenLock();
    
    // Centralizar inicialmente a área de escaneamento
    updateScanBoxPosition();
    
    // Atualizar quando o tamanho da janela mudar
    window.addEventListener('resize', updateScanBoxPosition);
    
    return () => {
      if (html5QrcodeRef.current) {
        html5QrcodeRef.current.stop().catch(error => console.error("Erro ao parar scanner:", error));
      }
      if (cooldownIntervalRef.current) {
        window.clearInterval(cooldownIntervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      window.removeEventListener('resize', updateScanBoxPosition);
    };
  }, []);

  // Centralizar a caixa de escaneamento quando o tamanho mudar
  const updateScanBoxPosition = () => {
    if (scannerContainerRef.current) {
      const containerWidth = scannerContainerRef.current.clientWidth;
      const containerHeight = scannerContainerRef.current.clientHeight;
      
      setScanBox(prev => ({
        ...prev,
        x: (containerWidth - prev.width) / 2,
        y: (containerHeight - prev.height) / 2
      }));
    }
  };

  useEffect(() => {
    if (isScanning && useFlash) {
      turnOnFlash();
    } else if (!useFlash) {
      turnOffFlash();
    }
  }, [useFlash, isScanning]);

  // Quando o scanner é iniciado, mostrar os controles
  useEffect(() => {
    if (isScanning) {
      setShowScanControls(true);
    } else {
      setShowScanControls(false);
    }
  }, [isScanning]);

  // Quando a área de escaneamento muda, atualiza o scanner
  useEffect(() => {
    if (isScanning && html5QrcodeRef.current) {
      // Se estiver escaneando e a região mudar, para e reinicia o scanner
      stopScanning();
      setTimeout(() => startScanning(), 300);
    }
  }, [scanBox]);

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
    if (html5QrcodeRef.current) {
      html5QrcodeRef.current.stop().catch(error => console.error("Erro ao parar scanner:", error));
      html5QrcodeRef.current = null;
    }
    setIsScanning(false);
  };

  const startCooldown = () => {
    setIsCooldown(true);
    setCooldownProgress(0);
    let progress = 0;
    
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

      if (html5QrcodeRef.current) {
        html5QrcodeRef.current.stop().catch(error => console.error("Erro ao parar scanner:", error));
      }

      const html5Qrcode = new Html5Qrcode("qr-reader");
      html5QrcodeRef.current = html5Qrcode;

      // Configurações do scanner com área de leitura em pixels exatos
      const qrConfig = {
        fps: 10,
        qrbox: {
          width: scanBox.width,
          height: scanBox.height,
          x: scanBox.x,
          y: scanBox.y
        },
        aspectRatio: 1.0,
        disableFlip: false,
      };

      console.log('QR Config:', qrConfig);

      await html5Qrcode.start(
        { deviceId: { exact: selectedCamera } },
        qrConfig,
        (decodedText) => {
          if (processingRef.current || isCooldown) return;

          if (decodedText === targetQRCode) {
            processingRef.current = true;
            captureFrame().finally(() => {
              processingRef.current = false;
            });
          }
        },
        (errorMessage) => {
          // Silenciar erros de leitura - são esperados quando não há QR code
          if (!errorMessage.includes("No QR code found")) {
            console.log(errorMessage);
          }
        }
      );

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

  // Funções de movimentação direta da área de leitura
  const moveUp = () => {
    setScanBox(prev => ({
      ...prev,
      y: Math.max(0, prev.y - 20)
    }));
  };

  const moveDown = () => {
    if (scannerContainerRef.current) {
      const maxY = scannerContainerRef.current.clientHeight - scanBox.height;
      setScanBox(prev => ({
        ...prev,
        y: Math.min(maxY, prev.y + 20)
      }));
    }
  };

  const moveLeft = () => {
    setScanBox(prev => ({
      ...prev,
      x: Math.max(0, prev.x - 20)
    }));
  };

  const moveRight = () => {
    if (scannerContainerRef.current) {
      const maxX = scannerContainerRef.current.clientWidth - scanBox.width;
      setScanBox(prev => ({
        ...prev,
        x: Math.min(maxX, prev.x + 20)
      }));
    }
  };

  // Funções para ajuste de tamanho
  const increaseWidth = () => {
    if (scannerContainerRef.current) {
      const maxWidth = scannerContainerRef.current.clientWidth - scanBox.x;
      setScanBox(prev => ({
        ...prev,
        width: Math.min(maxWidth, prev.width + 20)
      }));
    }
  };

  const decreaseWidth = () => {
    setScanBox(prev => ({
      ...prev,
      width: Math.max(100, prev.width - 20)
    }));
  };

  const increaseHeight = () => {
    if (scannerContainerRef.current) {
      const maxHeight = scannerContainerRef.current.clientHeight - scanBox.y;
      setScanBox(prev => ({
        ...prev,
        height: Math.min(maxHeight, prev.height + 20)
      }));
    }
  };

  const decreaseHeight = () => {
    setScanBox(prev => ({
      ...prev,
      height: Math.max(100, prev.height - 20)
    }));
  };

  // Reset da área de escaneamento para a posição central
  const resetScanRegion = () => {
    updateScanBoxPosition();
  };

  // Expandir área de escaneamento
  const expandScanRegion = () => {
    if (scannerContainerRef.current) {
      const containerWidth = scannerContainerRef.current.clientWidth;
      const containerHeight = scannerContainerRef.current.clientHeight;
      
      setScanBox(prev => {
        const newWidth = Math.min(containerWidth, prev.width + 40);
        const newHeight = Math.min(containerHeight, prev.height + 40);
        const newX = Math.max(0, prev.x - 20);
        const newY = Math.max(0, prev.y - 20);
        
        return {
          width: newWidth,
          height: newHeight,
          x: newX,
          y: newY
        };
      });
    }
  };

  // Reduzir área de escaneamento
  const shrinkScanRegion = () => {
    setScanBox(prev => ({
      width: Math.max(100, prev.width - 40),
      height: Math.max(100, prev.height - 40),
      x: prev.x + 20,
      y: prev.y + 20
    }));
  };

  // Renderizar uma visualização da área de escaneamento
  const renderScanBox = () => {
    if (!isScanning) return null;
    
    return (
      <div 
        className="absolute border-2 border-blue-500 pointer-events-none z-10"
        style={{
          left: scanBox.x,
          top: scanBox.y,
          width: scanBox.width,
          height: scanBox.height,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
        }}
      />
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="space-y-6">
          <div 
            ref={scannerContainerRef}
            className="aspect-[4/3] bg-gray-200 rounded-lg overflow-hidden relative"
          >
            <div id="qr-reader" className="w-full h-full"></div>
            {renderScanBox()}
          </div>
          
          {isScanning && showScanControls && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <h3 className="col-span-3 text-center font-medium text-sm">Controles da Área de Leitura</h3>
                
                {/* Controles de posição */}
                <div className="col-span-3">
                  <h4 className="text-xs font-medium text-center mb-1">Posição</h4>
                  <div className="grid grid-cols-3 gap-1">
                    <div className="col-start-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={moveUp}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="col-start-1 col-end-4 grid grid-cols-3 gap-1 mt-1">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={moveLeft}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={resetScanRegion}
                      >
                        Centralizar
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={moveRight}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="col-start-2 mt-1">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={moveDown}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Controles de tamanho */}
                <div className="col-span-3 mt-2">
                  <h4 className="text-xs font-medium text-center mb-1">Tamanho</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs block text-center">Largura</label>
                      <div className="flex space-x-1">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1"
                          onClick={decreaseWidth}
                        >
                          -
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1"
                          onClick={increaseWidth}
                        >
                          +
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs block text-center">Altura</label>
                      <div className="flex space-x-1">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1"
                          onClick={decreaseHeight}
                        >
                          -
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1"
                          onClick={increaseHeight}
                        >
                          +
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Botões de ajuste rápido */}
                <div className="col-span-3 flex space-x-2 mt-1">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1"
                    onClick={shrinkScanRegion}
                  >
                    <Minimize className="h-4 w-4 mr-1" />
                    Reduzir
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1"
                    onClick={expandScanRegion}
                  >
                    <Maximize className="h-4 w-4 mr-1" />
                    Expandir
                  </Button>
                </div>
              </div>
            </div>
          )}
          
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
