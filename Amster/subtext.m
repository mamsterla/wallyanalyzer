function h=subtext(str,xoff,yoff)
if nargin<2, xoff=0; end
if nargin<3, yoff=-3.1; end

h=text(xoff,yoff,str,'interp','none','Units','Char');