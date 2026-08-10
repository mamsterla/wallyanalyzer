function levelcheck
%see C:\Users\Fred Stanke\OneDrive\Documents\hifi\PhonoTracking\TEvsR33a.m
%  &TEvsR34.m
% 2024 07 04 LacquerTestRun03 reads the data and extracts sine "periods"
% between white noise bursts
% 2024 07 12 LacquerTestRun04 tosses points where LR and sine fits are poor
% 2024 07 12 LacquerTestRun05 instead of avoiding noise durations a priori,
%   it detects them and tosses them allowing 8 measurements per rotation,
%   fits Lathe offset plus Baerwald to the result, and fits sines to each
%   channel to determine frequency
% 2024 07 19 LacquerTestRun06 makes sense of the sines fit to the two
%   channels
% 2024 07 21 LacquerTestRun07, allow for choice of # of cycles at each
%   point and allow a quadratically perturnbed frequency across them
% 2024 07 23 LacquerTestRun10 synchronized to lagfreq10 just fit to sines
%   with parabolic frequency across core
% 2024 07 25 LacquerTestRun12 clean up plots, incl. f(t)
% 2024 07 28 LacquerTestRun13 strip out fitting of R to L, just fit sines
%   to each, abandon lag plot, just ZE 
% 2024 07 29 LacquerTestRun14 save and plot frequency constants
% 2024 08 05 LacquerTestQuery01 try to figure out what's wrong with really
%   long snippets
% 2024 08 06 LacquerTestRun20 go back to Fourier method: its pretty fast!
% 2024 08 11 LacquerTestRun21 allow new files with their own starts and
%   stops
% 2024 08 12 LacquerTestRun23 add negative frequencies to allow ifft
%   verification of lag and pad region of interest to allow convolutional
%   DC filter
% 2024 08 14 LacquerTestRun24 switch to predetermined indexing to help
%   trouble shooting the noise and use every other sample to avoid HF 
%   sawtooth in raw data that comes and goes on either channel
% 2024 08 26 LacquerTestRun25 JR discovered errors in Baerwald in above
% 2024 08 27 LacquerTestRun31 Comb through and fix various historical
%   errors as precursor to add fitting for eccentered frequency and ZE
% 2024 08 27 LacquerTestRun32 add fitting tracking error with lathe offset
%   and eccentered playback
% 2024 09 05 LacquerTestRun40 increase sampling to check for aliasing,
%   appears not to be an issue ???
% 2024 09 30 LacquerTestRun33 get uncertainties of fit variables and 
%  fix channel error from multidimensional FFT but with outstanding
%  ambiguity
% 2024 10 07 LacquerTestRun34 allow Baer fit over a limited range 
% 2024 10 02 LacquerTestRun50 fit parameters of Baerwald to aid in
%   diagnosing hardware adjustment
% 2024 10 24 AnalyzeSine01.m add measurement of harmonic distortion from 
%   NABcosmosTest...
% 2024 10 27 AnalyzeSine02.m fix more labelling errors, preallocate memory
%   allow choice to float lathe offset, remove spurious plotting commands
% 2024 11 15 AnalyzeSine04.m introduce endEnv to deal with [play 4.wav] and
%   beyond lacquer recordings
% 2024 11 17 AnalyzeSine05.m fix pitch & try to read onedrive recording xls 
% 2024 11 20 MeasureSine00.m & FitZenith00.m  break into two functions so
%    different fittings can be tried more efficiently
% 2024 12 07 MeasureSine01.m improve finding beginning and end of lacquer
%   modulation
% 2024 12 21 MeasureSine01.m troubleshoot display of Dt on waveforms
% 2025 01 18 MeasureSine10a.m Return to this after doing theoretical touch
%  study and am having a hard time reproducing previous results
%  -remove plot of filters applied for time-domain analysis and nlp
% 2025 01 27 For Round5lacquer with CompileSine14.m
%  -remove the updown flag to be handled by CompileSine14
% 2025 02 09 MeasureSine12.m get rid of meassetup.m and rely completely on
%   "Research Recording Tracking Sheet.xls'
% 2025 02 10 MeasureSine12a.m version for 
%   STR112 Side A Track 2 at +6dB +9dB +12dB +15dB +18db 300Hz Lateral.wav
%   to deal with the varying amplitudes
% 2025 04 14 MeasureSine13a.m diagnose why widths are so small by
%   simulating data.  I am concerned about wow etc. corrupting the results.
%   I think I did not pursue this because
%   \PhonoTracking\Repeatability\Round2\SeriesD_25um_0.14CCWerr shows that
%   reasonable widths can be had: maybe the issue has been the lacquer

global frng trng
plotflag=1;
mfile=dir(which(mfilename));
%meassetup %for current working directory!!!
TrackPath='C:\Users\Fred Stanke\OneDrive\Documents\hifi\PhonoTracking\Repeatability\Round4lacquer\';
Tracker='Research Recording Tracking Sheet.xlsx';
disp(['CLOSE ' pwdshort(3,[TrackPath Tracker])]);
[AcqData,AcqText]=xlsread([TrackPath Tracker],1);
jFile=cellfind(regexp(AcqText(1,:),'File'));
jDigit=cellfind(regexp(AcqText(1,:),'Digit'));
jTestTrack=cellfind(regexp(AcqText(1,:),'Test Track'));
Files=AcqText(2:end,jFile);
[TestTrackData,TestTrackText]=xlsread([TrackPath Tracker],2);
jTestTrackName=cellfind(regexpi(TestTrackText(1,:),'Name'));
TestTracks=TestTrackText(2:end,jTestTrackName);
jOuterRadius=cellfind(regexpi(TestTrackText(1,:),'Outer radius'))-1;
jInnerRadius=cellfind(regexpi(TestTrackText(1,:),'Inner radius'))-1;
skip=10; %45 %15; 10
Mperiod=64; %selectable # of periods in sample of interest (SOI)
navg=16;
%files={'Play32.wav','Play30.wav','Play31.wav'}
%files={'Play06.wav'};
%files={'A 250512.wav'};
%list=dir('heyLac2*.wav');
%list=dir('*3kHz*.wav');
%files={'RTI1P1.wav'}   
% list=dir('RTI2P*.wav');
% [files{1:length(list)}]=deal(list.name);
%files={'RTI2P6.wav','RTI2P7.wav','RTI2P8.wav','RTI2P9.wav','RTI2P10.wav'};
files={'RTI2P16.wav','RTI2P17.wav','RTI2P18.wav','RTI2P19.wav',...
    'RTI2P20.wav'};
files={'RTI2P30.wav'};
for ii=1:length(files) %:length(list);
    file=files{ii};
    disp(file);
    %bopper warn;
    
    % INFO =
    %              Filename: 'C:\Users\Fred Stanke\OneDrive\Documents\hifi\PhonoTracking\Repeatability\Round3l…'
    %     CompressionMethod: 'Uncompressed'
    %           NumChannels: 2
    %            SampleRate: 192000
    %          TotalSamples: 69029436
    %              Duration: 359.5283
    %         BitsPerSample: 24
    INFO = audioinfo(file);
    No=INFO.TotalSamples; %original number of samples
    [jnk,name]=fileparts(file);
    try
    iFile=cellfind(regexpi(Files,name)); % this file's name is in the mat
    iFile=iFile(end); %stupid patch for muliple mat's from same wav
    Digitizer=AcqText(iFile+1,jDigit); %Data columns are 2 less than Text cols
    Digitizer=Digitizer{1};
    if ~isempty(regexpi(Digitizer,'tascam'))
        decimate=2;
    elseif ~isempty(regexpi(Digitizer,'cosmos'))
        decimate=1;
    else
        disp(['MeasureSine does not recognize digitizer: ' Digitizer])
        bopper error
        keyboard
    end
    TestTrack=AcqText(iFile+1,jTestTrack); 
    iTestTrack=cellfind(regexpi(TestTracks,TestTrack)); % this file's name is in the mat
    rend=TestTrackData(iTestTrack,jInnerRadius);
    rbeg=TestTrackData(iTestTrack,jOuterRadius);
    if any(isnan([rend rbeg])),
        disp(['[rend rbeg]: ' mat2str([rend rbeg])]);
        bopper error
        keyboard
    end
    catch
        decimate=1;
    end
    N0=No/decimate; % decimated
    Fso=INFO.SampleRate; %original
    Fs=Fso/decimate; % decimated
    dt=1/Fs; %decimated sample time
    Nrev=3*60/100/dt; %# of samples in a revolution
    Nperiod=round(.001/dt); %# of samples in one period of the 1kHz sinewave
    Nskip=round(Nrev/360*skip); %# of samples to skip between segment starts
    SPR=1.8000; %s per rotation = 60*3/100 ***inaccurate up to 8/9/2024
    nfilt=500/decimate+1; %decimated length of low-pass filter to be subtracted for high-pass
    filt=nuttall(nfilt);  filt=filt./sum(filt);
    noi=(Mperiod*Nperiod); %# of samples in processing domain
    Noi=noi+nfilt-1; % processing domain before HP convolution
    soi=((nfilt-1)/2+1:Noi-(nfilt-1)/2)'; %pre conv centered segment of interest
    Irng=[0:Noi-1]'; %time-domain index pre-conv segment
    irng=[0:noi-1]'; %time-domain index range convolved segment
    jrng=ifftshift(-noi/2:noi/2-1)'; %Fourier-domain index range
    win=repmat(nuttall(noi),1,2); %apodization in time
    trng=irng*dt; %time domain of segments
    df=1/dt/noi;
    V0=6*.01; %m/s, cut velocity 6cm/s
    Omega=100/3*2*pi/60; %radians/s angular velocity of rotation m
    frng=jrng*df;
    hw=5; % spectral peaks are 2*hw+1 points wide
    
    [y]=audioread(file,'native');
    if decimate==2,
        y=y(1:2:end,:);
    end
    clear Env
    Nsp=floor(N0/Nperiod);
    ienv=1:Nsp*Nperiod;
    Env(:,1)=max(abs(reshape(y(ienv,1),Nperiod,Nsp)))';
    Env(:,2)=max(abs(reshape(y(ienv,2),Nperiod,Nsp)))';
    iEnv=(round(Nperiod/2):Nperiod:N0)';
    while size(Env,1)<size(iEnv,1),
        iEnv(end)=[];
    end
    [mEnv,nEnv]=size(Env);
    level=median(Env(:,1));
    dEnv=diff(Env,1,2);
    hit=find(dEnv(floor(mEnv/2):end,:)>level/10)+floor(mEnv/2)-1;
    
    if rend>rbeg
        rot=-1; %CCW play
    else
        rot=1; %CW play;
    end
    %WIN=ones(5,1)/5;
    %ENV=conv(single(Env(:,1)),WIN,'same');
    WIN=[0:8]; %for finding the beginning of Env
    for ibeg=1:mEnv,
        if(all(Env(ibeg+WIN,1)>(0.3*level))); break; end; end
    startEnv=iEnv(ibeg); %iEnv are data sample numbers
    WIN=[-8:0]; %for finding the end of Env
    for iend0=mEnv:-1:1,
        if(all(Env(iend0+WIN,1)>(0.3*level))); break; end; end
    iend=iend0-1;
    endEnv=iEnv(iend);
    N=endEnv-startEnv+1;
    T=N*dt;
    try
        pitch=(rbeg-rend)*SPR/T; %0.0173";
    end
    figure(666); clf;
    plot(iEnv*dt,Env,'-');
    hold on; grid on;
    hstart=vline(startEnv,'o-k');
    hend=vline(endEnv,'o-k');
    ylabel('Envelope'); xlabel('Sample #');
    legend('L','R','Location','best');
    title(breakstring([pwdshort(3) '/' file],-50));
    drawnow;
    %end
    %if 1
    clear Env iEnv mEnv nEnv
    is=0; %counter of processed segments
    imid=startEnv+ceil(Noi/2):Nskip:(endEnv-Noi); %center indices of segments
    ns=length(imid)-1; %exclude last possibly incomplete segment
    if imid(ns(end))+length(irng)>N,
        ns=ns-1;
    end
    is1=[];
    iproc=0;
    lag=zeros(1,ns); F=zeros(ns,2); H=zeros(ns,3);
    tic;
    for is=1:ns %over segments at skipdeg
        y1=double(y(imid(is)+Irng,:));
        figure(666); hold on; plot(imid(is)+noi/2,1e-9,'x'); %middle of pr. domain
        if rem(is,round(ns/10))==1; drawnow; end
        %check beginning and end of snippet for white noise
        if any(2*rms(y1(1:500,:),1)<max(abs(y1(1:500,:)))) ||...
                any(2*rms(y1(end-(499:-1:0),:),1)...
                <max(abs(y1(end-(499:-1:0),:)))) ||...
                any(max(abs(y1))<level/2),
            lag(is)=nan; F(is,1:2)=nan;
            %figure(700); clf; plot(y1); title(num2str(is)); pause(1);
        else %process
            if isempty(is1), is1=is; end
            iproc=iproc+1;
            y2=(y1(soi,:)-conv2(y1,filt,'valid')).*win; %high pass filter
            [lag(is),F(is,:),H(is,:)]=...
                fftlag(y2,dt,df,hw,plotflag);
            if plotflag,
                drawnow;
                figure(667);
                subplot(2,1,1);
                title({file,['Segment# ' int2str(is) ' \theta='...
                    num2str(rem(is,8)*skip) '^o']});
                subplot(2,1,2);
                title(['Mperiod=' int2str(Mperiod) ', Lag='...
                    num2str(lag(is)*1e6,4) '\mus, f_{sine}=' ...
                    num2str(F(is,1)/1e3,4) 'kHz']) ;
                ylabel('|FFT| (au)'); xlabel('Frequency (Hz)')
                drawnow;
            end
            if iproc==3; plotflag=0; end %keyboard;
            if 0 %rem(is,100)==1, 
                USERVIEW = memory;
                ttoc=toc; 
                disp([num2str(USERVIEW.MemUsedMATLAB,3) ' ' num2str(ttoc)]);
            end
        end
    end
    PT=toc;
    mis=find(abs(lag)>1.5e-5);
    lag(mis)=nan;
    FWHM=num2str(noi/Nrev*360*...
            diff(find(abs(diff(win/max(win)>.5))))/length(win),3);    
    [pathstr,name,ext]=fileparts(mfile.name);
    [pathstr,dataname,ext]=fileparts(file);
    fileout=[name '_' dataname '_c' int2str(Mperiod) '_p'...
        int2str(2*hw+1) '.mat']
    save(fileout,...
        'lag','F','H','dt','hw','Mperiod','mfile','file','pathstr',...
        'pitch','is','is1','T','V0','Omega','ns',...
        'noi','Nrev','FWHM','PT','rbeg','rend','skip','Nskip','ibeg',...
        'iend','imid')
end
keyboard

function [lag,F,H]=fftlag(a0,dt,df,hw,plotflag)
% $$$  find the lag seconds between a(:,1) and a(:,2) sampled at dt and df
%   in the t and f domains, respectively, from 2*hw+1 spectral points
% $$$    from FFTs
% 2024 07 06 interpfit.m working LR lag computation with splines
% 2024 07 06 lagfreq.m to get frequency as well as the delay of the sines, 
%            so there are two lag solutions and it may be possible to infer
%            the rotation angle from wow.
% lagfreq06 saved 2024 07 21
% lagfreq07 2024 07 21 allow parabolic variation of frequency.  THIS HAS AN
%   ERROR looking at a(hit,ic) for zero crossings instead of
%   a(core(hit),ic)
% lagfreq08 2024 07 23 repair 07!
    global frng trng

lag=nan; F=nan; 
irng=-hw:hw; %range of points to consider around fundamental
hrng=-2:2; %range of points to consider for harmonic amplitudes
%%% if nargin<7, plotflag=0; end
[m,n]=size(a0); 
if n~=2, bopper error; keyboard; end
sd=std(a0);
a=a0./repmat(sd,[m 1]);

A=fft(ifftshift(a,1));
if 0,
    figure; subplot(2,1,1);
    plot(a);
    subplot(2,1,2);
    semilogy(abs(A));
    title(mat2str([3*rms(a,1) max(abs(a))],7));
end
try
    Ps=abs(A).^2;
    P=mean(Ps,2);
    [Apeak,ipeak0]=max(P(1:m/2-1)); %positive freq's
    ipeak=ipeak0(1)+[-hw:hw];
    npeak=m-ipeak+1;
    phi=angle(A(ipeak,:));
    dphi=diff(phi,1,2);
    dphi0=median(dphi);
    big=find(dphi-dphi0>pi);
    lit=find(dphi-dphi0<-pi);
    if ~isempty(big)|~isempty(lit),
        dphi1=dphi;
        %disp('Phase wrap'); bopper warn;
        dphi(big)=dphi(big)-2*pi*ceil((dphi(big)-dphi0)/2/pi);
        dphi(lit)=dphi(lit)+2*pi*ceil((dphi0-dphi(lit))/2/pi);
        %figure; plot(dphi1,'x'); hold on; plot(dphi,'o');
        %keyboard;
    end
    weights0=Ps(ipeak,:);
    weights=weights0./repmat(sum(weights0),2*hw+1,1);
    weight0=sum(weights0,2);
    weight=weight0/sum(weight0);
    lags=dphi/2/pi./frng(ipeak);
    lag=lags'*weight;
    F=frng(ipeak)'*weights;
    H(1)=sqrt(sum(P(ipeak)));
    AF=zeros(size(A));
    AF(ipeak,:)=A(ipeak,:); %spectrum of fundamental
    AF(npeak,:)=A(npeak,:); %spectrum of fundamental
    
    [Apeak2,ipeak20]=max(P(ipeak0*2+irng));
    ipeak21=ipeak0*2+irng(ipeak20);
    ipeak22=ipeak21+hrng;
    H(2)=sqrt(sum(P(ipeak22)));
    
    [Apeak3,ipeak30]=max(P(ipeak0*3+irng));
    ipeak31=ipeak0*3+irng(ipeak30);
    ipeak32=ipeak31+hrng;
    H(3)=sqrt(sum(P(ipeak32)));
    
    if plotflag,
        hv2=vline(frng(ipeak21),'k--');
        hv3=vline(frng(ipeak31),'k--');
        pos=1:m/2-1;
        phifix=2*pi.*frng*lag;
        figure(667); clf; halffig; %(667)
        subplot(2,1,1); cla;
        h1=plot(trng,a(:,1),'.:'); set(h1,'Color',green);
        hold on; grid on;
        h2=plot(trng,a(:,2),'r.:');
        if 0    %lag verification
            af=real(fftshift(ifft(AF),1));
            bf=real(fftshift(ifft(AF(:,2).*exp(-1i*2*pi*frng*lag)),1));
            h3=plot(trng,diff(af,1,2),'.:');
            h4=plot(trng,diff(a,1,2),':')
            disp([rms(diff(af,1,2)) rms(diff(a,1,2)) rms(a,1)]);
            bopper prompt; keyboard;
        end
        axis tight
        ylabel('Signal'); xlabel('Sample Time (s)');
        hl=legend('L','R'); set(hl,'Box','off')
        subplot(2,1,2); cla;
        h3=loglog(frng(pos),sqrt(Ps(pos,:)));
        set(h3(1),'Color','green')
        hold on; grid on;
        h4=plot(frng(ipeak),sqrt(Ps(ipeak,:)),'r.');
        set(h4(1),'Color','green')
        axis tight;
        ax=axis;
        logtop=ceil(log10(max(sqrt(P(ipeak)))));
        top=10^logtop;
        set(gca,'YLim',top*[1e-8 1]); 
        ytick=10.^(logtop+[-8:0]);
        set(gca,'YTick',ytick);
        hp12=plot(mean(F),H(1),'kd','MarkerFaceColor','k');
        hp21=plot(frng(ipeak22),sqrt(P(ipeak22)),'k.');
        hp22=plot(frng(ipeak0*2+irng(ipeak20)),(H(2)),'bs','MarkerFaceColor','b');
        hp31=plot(frng(ipeak32),sqrt(P(ipeak32)),'k.');
        hp32=plot(frng(ipeak0*3+irng(ipeak30)),H(3),'go','MarkerFaceColor','g');
        hl=legend([hp12 hp22 hp32],[num2str(mean(F),6) 'Hz'],...
            [num2str(100*H(2)/H(1),3) '%'],[num2str(100*H(3)/H(1),3) '%'],...
            'Location','best');
        set(get(hl,'Title'),'String','Freq./Amp.Dist.')
        drawnow;
        if 0
        af=real(ifft(AF));
        Frng=fftshift(frng);
        af=af./repmat(rms(af,1),m,1);
        T=1/mean(F);
        [apeak,ipeak]=max(max(af,[],2));
        mt=round(T/2/dt); rng=ipeak+[-mt:mt];
        plot(trng(rng),af(rng,:),'.:'); hold on; grid on;
        %err=@(rms(d) af(:,1)-real(fftshift(ifft(AF(:,2).*exp(i*2*pi*f*d),1));
        end
    end
end
  
        



