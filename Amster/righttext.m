function h=righttext(str,xoff,yoff,haxis)
if nargin<2, xoff=[]; end %!!!xoff and yoff are IGNORED, left for back compat.
if nargin<3, yoff=[]; end
if isempty(xoff), xoff=4; end
if isempty(yoff), yoff=0; end
if nargin<4, haxis=gca; end
ca=gca;
axes(haxis);
pos=get(haxis,'pos');
ht=axes('Position',[.99 pos(2) .01 pos(4)]); 
set(ht,'color',.95*[1 1 1],'xticklabel','','yticklabel','','XColor',...
       .95*[1 1 1],'YColor',.95*[1 1 1])
h=text(1,0,str,'interp','none','Rot',90,'VerticalA','bot');
ht=[ht;h];
axes(ca);